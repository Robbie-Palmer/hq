import { createBackend } from '@backstage/backend-defaults';
import { createBackendModule } from '@backstage/backend-plugin-api';
import { createTemplateAction, scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { mkdir, readFile, cp, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';

const execute = promisify(execFile);
const runtime = resolve(process.env.SPIKE_RUNTIME ?? '.runtime');
const template = resolve(runtime, 'template');
const origin = 'http://127.0.0.1:7483';
// Local stand-in for repository hosting. Only catalog declarations are served.
createServer(async (req, res) => {
  const project = /^\/projects\/([a-z][a-z0-9-]{0,39})\/catalog-info.yaml$/.exec(req.url);
  const path = req.url === '/template.yaml' ? resolve('template.yaml')
    : project ? resolve(runtime, 'projects', project[1], 'catalog-info.yaml') : undefined;
  if (!path) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', 'text/yaml'); res.end(await readFile(path)); }
  catch { res.writeHead(404).end(); }
}).listen(7484, '127.0.0.1');

async function checkExistingProfile(profilePath, inputs) {
  const { parse } = await import('yaml');
  const profile = parse(await readFile(profilePath, 'utf8'));
  if (profile.project !== inputs.name || profile.owner !== inputs.owner) {
    throw new Error('Existing project inputs differ; request a migration');
  }
}
async function registerComponent(name) {
  const existing = await fetch(`${origin}/api/catalog/entities/by-name/component/default/${name}`);
  if (existing.status === 404) {
    const response = await fetch(`${origin}/api/catalog/locations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'url', target: `http://127.0.0.1:7484/projects/${name}/catalog-info.yaml` }),
    });
    if (!response.ok && response.status !== 409) throw new Error(`Catalog registration failed: ${response.status}`);
  } else if (!existing.ok) throw new Error(`Catalog lookup failed: ${existing.status}`);
}

const backend = createBackend();
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'));
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'pep-spike',
  register(env) {
    env.registerInit({
      deps: { scaffolder: scaffolderActionsExtensionPoint },
      async init({ scaffolder }) {
        scaffolder.addActions(createTemplateAction({
          id: 'pep:project:generate',
          supportsDryRun: true,
          schema: { input: {
            name: z => z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
            owner: z => z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
          } },
          async handler(ctx) {
            const destination = resolve(runtime, 'projects', ctx.input.name);
            const inputs = { ...ctx.input, effective_date: '2026-09-30' };
            const profilePath = resolve(destination, 'platform-profile.yaml');
            if (!ctx.isDryRun) {
              try {
                await access(destination);
                await checkExistingProfile(profilePath, inputs);
                ctx.output('catalogInfoPath', resolve(destination, 'catalog-info.yaml'));
                ctx.output('profilePath', profilePath);
                ctx.output('reused', true);
                return;
              } catch (error) {
                if (error.code !== 'ENOENT') throw error;
              }
            }
            // Generator output stays in Backstage's disposable task workspace.
            await execute('uv', ['tool', 'run', '--from', 'copier==9.18.2', 'copier',
              'copy', '--defaults', '--vcs-ref=v1.0.0',
              ...Object.entries(inputs).flatMap(([key, value]) => ['--data', `${key}=${value}`]),
              template, ctx.workspacePath], { env: { PATH: process.env.PATH, HOME: process.env.HOME } });
            if (!ctx.isDryRun) {
              await mkdir(resolve(runtime, 'projects'), { recursive: true });
              await cp(ctx.workspacePath, destination, { recursive: true, force: false, errorOnExist: true });
            }
            ctx.output('catalogInfoPath', resolve(destination, 'catalog-info.yaml'));
            ctx.output('profilePath', profilePath);
            ctx.output('reused', false);
          },
        }), createTemplateAction({
          id: 'pep:catalog:register',
          supportsDryRun: true,
          schema: { input: { name: z => z.string().regex(/^[a-z][a-z0-9-]{0,39}$/) } },
          async handler(ctx) {
            const entityRef = `component:default/${ctx.input.name}`;
            if (!ctx.isDryRun) {
              await registerComponent(ctx.input.name);
            }
            ctx.output('entityRef', entityRef);
          },
        }));
      },
    });
  },
}));
await backend.start();
