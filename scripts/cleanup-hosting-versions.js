#!/usr/bin/env node
// Runs automatically as this project's Hosting "postdeploy" hook (see
// firebase.json) after every `firebase deploy`. Firebase Hosting keeps the
// full file set of every single deployed version forever by default, for
// rollback - with no automatic pruning, frequent iteration silently piles
// up storage over time (this project once reached 348 retained versions
// and 10.8GB before a one-off manual cleanup). This keeps that from
// happening again by deleting everything except the most recent versions
// right after each deploy, since the live site only ever serves the newest
// one anyway - older ones are purely rollback history nobody was using.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const KEEP_COUNT = 2; // the live version + one previous, for a one-step rollback

function getAccessToken() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const token = data.tokens && data.tokens.access_token;
  if (!token) throw new Error('No cached firebase-tools access token found');
  return token;
}

function request(method, url, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers: { Authorization: 'Bearer ' + token } }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function listAllVersions(site, token) {
  let pageToken = '';
  let all = [];
  do {
    const url = `https://firebasehosting.googleapis.com/v1beta1/sites/${site}/versions?pageSize=100${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res = await request('GET', url, token);
    if (res.status !== 200) throw new Error(`List versions failed: ${res.status} ${res.body}`);
    const json = JSON.parse(res.body);
    all = all.concat(json.versions || []);
    pageToken = json.nextPageToken;
  } while (pageToken);
  return all;
}

async function main() {
  const site = process.env.GCLOUD_PROJECT;
  if (!site) {
    console.warn('[cleanup-hosting-versions] GCLOUD_PROJECT not set, skipping');
    return;
  }

  const token = getAccessToken();
  const versions = await listAllVersions(site, token);

  // The live release is always the newest FINALIZED version. Versions
  // still in CREATED (e.g. an aborted/in-progress deploy elsewhere) are
  // left untouched rather than guessed about.
  const finalized = versions.filter(v => v.status === 'FINALIZED');
  finalized.sort((a, b) => new Date(b.createTime) - new Date(a.createTime));
  const toDelete = finalized.slice(KEEP_COUNT);

  if (!toDelete.length) {
    console.log(`[cleanup-hosting-versions] ${site}: ${finalized.length} version(s), nothing to clean up`);
    return;
  }

  console.log(`[cleanup-hosting-versions] ${site}: deleting ${toDelete.length} old version(s), keeping the latest ${KEEP_COUNT}`);
  let ok = 0, fail = 0;
  for (const v of toDelete) {
    const id = v.name.split('/').pop();
    const res = await request('DELETE', `https://firebasehosting.googleapis.com/v1beta1/sites/${site}/versions/${id}`, token);
    if (res.status === 200) ok++;
    else { fail++; console.warn(`[cleanup-hosting-versions]   failed to delete ${id}: ${res.status} ${res.body.slice(0, 200)}`); }
  }
  console.log(`[cleanup-hosting-versions] ${site}: deleted ${ok}, failed ${fail}`);
}

main().catch(err => {
  // Best-effort only - a cleanup hiccup should never be treated as a
  // failed deploy (the deploy itself already succeeded by the time this
  // postdeploy hook runs).
  console.warn('[cleanup-hosting-versions] skipped due to error:', err.message);
});
