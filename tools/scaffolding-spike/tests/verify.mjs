import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, cp, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parse } from 'yaml';
import { createServer } from 'node:net';

for (const port of [7483, 7484]) {
  const probe = createServer();
  await new Promise((done, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', done);
  });
  await new Promise(done => probe.close(done));
}

const exec = promisify(execFile);
await mkdir('.runtime', { recursive: true });
const runtime = await mkdtemp(resolve('.runtime/run-'));
const templatePath = resolve(runtime, 'template');
await cp('template', templatePath, { recursive: true });
const git = (...args) => exec('git', ['-C', templatePath, ...args]);
await git('init');
await git('add', '.');
await git('-c', 'user.name=Spike', '-c', 'user.email=spike@example.invalid', 'commit', '-m', 'v1');
await git('tag', 'v1.0.0');
const log = [];
const child = spawn(process.execPath, ['backend.mjs'], {
  env: { ...process.env, SPIKE_RUNTIME: runtime }, stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', chunk => log.push(chunk.toString()));
child.stderr.on('data', chunk => log.push(chunk.toString()));
const origin = 'http://127.0.0.1:7483';
async function request(path, body) {
  const response = await fetch(`${origin}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
async function until(fn, message) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Backend exited: ${log.join('')}`);
    try { const value = await fn(); if (value) return value; } catch { /* poll readiness */ }
    await delay(500);
  }
  await writeFile(resolve(runtime, 'backend.log'), log.join(''));
  throw new Error(`${message}\n${log.filter(line => /error|warn/i.test(line)).join('').slice(-12000)}`);
}
try {
  await until(() => request('scaffolder/v2/actions'), 'Backend did not start');
  assert.equal((await fetch('http://127.0.0.1:7484/forbidden')).status, 404);
  assert.equal((await fetch('http://127.0.0.1:7484/projects/%2e%2e%2f/catalog-info.yaml')).status, 404);
  assert.equal((await fetch('http://127.0.0.1:7484/projects/missing/catalog-info.yaml')).status, 404);
  const registration = await request('catalog/locations', { type: 'url', target: 'http://127.0.0.1:7484/template.yaml' });
  const template = await until(() => request('catalog/entities/by-name/template/default/pep-minimal-project'), 'Template not ingested');
  const values = { name: 'spike-project', owner: 'robbie' };
  const dryRun = await request('scaffolder/v2/dry-run', { template, values, directoryContents: [], secrets: { sentinel: 'spike-secret-must-not-persist' } });
  assert.ok(!JSON.stringify(dryRun).includes('spike-secret-must-not-persist'));
  assert.ok(dryRun.directoryContents.some(file => file.path === 'platform-profile.yaml'));
  await assert.rejects(access(resolve(runtime, 'projects', values.name)));
  await assert.rejects(request('catalog/entities/by-name/component/default/spike-project'));
  async function task(parameters) {
    const created = await request('scaffolder/v2/tasks', { templateRef: 'template:default/pep-minimal-project', values: parameters });
    const finished = await until(async () => {
      const result = await request(`scaffolder/v2/tasks/${created.id}`);
      return ['completed', 'failed'].includes(result.status) && result;
    }, 'Task did not finish');
    return { id: created.id, status: finished.status };
  }
  const created = await task(values);
  assert.equal(created.status, 'completed');
  const entity = await until(() => request('catalog/entities/by-name/component/default/spike-project'), 'Component not ingested');
  const destination = resolve(runtime, 'projects', values.name);
  const profile = parse(await readFile(resolve(destination, 'platform-profile.yaml'), 'utf8'));
  assert.equal(profile.project, values.name);
  assert.equal(profile.owner, values.owner);
  const answers = parse(await readFile(resolve(destination, '.copier-answers.yml'), 'utf8'));
  assert.equal(answers._commit, 'v1.0.0');
  const original = await readFile(resolve(destination, 'src/index.mjs'), 'utf8');
  await writeFile(resolve(destination, 'product-owned.txt'), 'Keep this local addition');
  const retry = await task(values);
  assert.equal(retry.status, 'completed');
  assert.equal(await readFile(resolve(destination, 'product-owned.txt'), 'utf8'), 'Keep this local addition');
  assert.equal(await readFile(resolve(destination, 'src/index.mjs'), 'utf8'), original);
  const changedInputs = await task({ ...values, owner: 'other' });
  assert.equal(changedInputs.status, 'failed');
  await assert.rejects(request('scaffolder/v2/tasks', { templateRef: 'template:default/pep-minimal-project', values: { ...values, name: '../escape' } }));
  const projectGit = (...args) => exec('git', ['-C', destination, ...args]);
  await projectGit('init');
  await projectGit('add', '.');
  await projectGit('-c', 'user.name=Spike', '-c', 'user.email=spike@example.invalid', 'commit', '-m', 'Generated');
  await writeFile(resolve(destination, 'src/index.mjs'), "export const project = 'local-change';\n");
  await projectGit('add', '.');
  await projectGit('-c', 'user.name=Spike', '-c', 'user.email=spike@example.invalid', 'commit', '-m', 'Local change');
  await writeFile(resolve(templatePath, 'src/index.mjs.jinja'), "export const project = '{{ name }}-v2';\n");
  await git('add', '.');
  await git('-c', 'user.name=Spike', '-c', 'user.email=spike@example.invalid', 'commit', '-m', 'v2');
  await git('tag', 'v2.0.0');
  const update = await exec('uv', ['tool', 'run', '--from', 'copier==9.18.2', 'copier', 'update', '--defaults', '--vcs-ref=v2.0.0', '--conflict=inline'], { cwd: destination });
  const conflict = await readFile(resolve(destination, 'src/index.mjs'), 'utf8');
  assert.match(conflict, /<<<<<<<|\.rej/);
  assert.match(conflict, /local-change/);
  const evidence = { registration: registration.location.type, templateRef: 'template:default/pep-minimal-project',
    dryRunFiles: dryRun.directoryContents.map(file => file.path), created, retry, changedInputs,
    entityRef: `component:default/${entity.metadata.name}`,
    catalogEntity: { apiVersion: entity.apiVersion, kind: entity.kind,
      metadata: { name: entity.metadata.name, annotations: entity.metadata.annotations }, spec: entity.spec }, profile, copierAnswers: { ...answers, _src_path: '<disposable tagged template>' },
    updateConflictDetected: true, copierUpdateExit: 0, updateMessage: update.stderr.trim(), runtime };
  await writeFile(resolve(runtime, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), delay(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
