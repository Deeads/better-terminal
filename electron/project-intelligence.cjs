const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parse } = require('smol-toml');
const markers = ['better-terminal.toml', '.better-terminal.toml', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'requirements.txt'];
const safeCommand = value => typeof value === 'string' && value.length <= 4000 && !/[\x00-\x1f\x7f]/.test(value) && !!value.trim();
const within = (folder, root) => { const relative = path.relative(root, folder); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
function findRoot(folder, registered = []) {
  const boundary = registered.filter(p => p.saved && within(folder, p.path)).sort((a, b) => b.path.length - a.path.length)[0]?.path;
  let current = path.resolve(folder);
  for (let i = 0; i < 20; i++) {
    try {
      const names = fs.readdirSync(current);
      if (markers.some(name => names.includes(name)) || names.some(name => /\.(csproj|fsproj|sln|slnx)$/i.test(name))) return current;
      if (names.includes('.git')) return current;
    } catch { return boundary || folder; }
    if ((boundary && path.relative(boundary, current) === '') || current === os.homedir()) break;
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  return boundary || folder;
}
function detectProject(folder, registered = []) {
  const root = findRoot(folder, registered);
  const result = { root, name: path.basename(root), stack: [], sources: [], commands: [], warnings: [] };
  const exists = file => fs.existsSync(path.join(root, file));
  const addStack = name => { if (!result.stack.includes(name)) result.stack.push(name); };
  const read = (name, format) => {
    if (!exists(name)) return null;
    result.sources.push(name);
    try {
      if (fs.statSync(path.join(root, name)).size > 1024 * 1024) throw new Error('file exceeds 1 MB');
      const text = fs.readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, '');
      return format === 'json' ? JSON.parse(text) : format === 'toml' ? parse(text) : text;
    } catch (error) { result.warnings.push(`Could not read ${name}: ${error.message}`); return null; }
  };
  const add = (command, description, source, label = '') => {
    if (!safeCommand(command) || result.commands.some(item => item.command === command)) return;
    result.commands.push({ command, description: String(description || '').slice(0, 200), source, label: String(label || '').slice(0, 80), cwd: root });
  };
  const customFile = exists('better-terminal.toml') ? 'better-terminal.toml' : '.better-terminal.toml';
  const custom = read(customFile, 'toml');
  if (custom) {
    if (typeof custom.project?.name === 'string') result.name = custom.project.name.slice(0, 80);
    for (const tag of Array.isArray(custom.project?.stack) ? custom.project.stack : []) if (typeof tag === 'string') addStack(tag.slice(0, 32));
    const commands = custom.commands;
    if (commands && typeof commands === 'object' && !Array.isArray(commands)) for (const [label, value] of Object.entries(commands)) add(typeof value === 'string' ? value : value?.run, typeof value === 'string' ? label : value?.description || label, customFile, label);
  }
  const pkg = read('package.json', 'json');
  if (pkg) {
    addStack('Node.js');
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [dependency, name] of [['typescript', 'TypeScript'], ['react', 'React'], ['next', 'Next.js'], ['vue', 'Vue'], ['nuxt', 'Nuxt'], ['svelte', 'Svelte'], ['vite', 'Vite'], ['electron', 'Electron'], ['express', 'Express'], ['@nestjs/core', 'NestJS']]) if (deps[dependency]) addStack(name);
    const specified = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : '';
    const manager = ['npm', 'pnpm', 'yarn', 'bun'].includes(specified) ? specified : exists('pnpm-lock.yaml') ? 'pnpm' : exists('yarn.lock') ? 'yarn' : exists('bun.lock') || exists('bun.lockb') ? 'bun' : 'npm';
    result.packageManager = manager;
    const scripts = pkg.scripts;
    const priorities = ['dev', 'start', 'build', 'test', 'lint', 'check', 'typecheck', 'format', 'preview'];
    if (scripts && typeof scripts === 'object') for (const name of Object.keys(scripts).sort((a, b) => { const rank = x => priorities.includes(x) ? priorities.indexOf(x) : 99; return rank(a) - rank(b); })) {
      if (!/^[\w:@./-]+$/.test(name) || typeof scripts[name] !== 'string') continue;
      add(`${manager} run ${name}`, scripts[name], 'package.json', name);
    }
    add(`${manager} install`, 'Install project dependencies', 'package.json', 'install');
  }
  const python = read('pyproject.toml', 'toml');
  if (python || exists('requirements.txt')) {
    addStack('Python');
    const manager = exists('uv.lock') || python?.tool?.uv ? 'uv' : python?.tool?.poetry || exists('poetry.lock') ? 'poetry' : 'python';
    const run = manager === 'python' ? '' : `${manager} run `;
    const dependencies = JSON.stringify([python?.project?.dependencies, python?.project?.['optional-dependencies'], python?.['dependency-groups'], python?.tool?.poetry, read('requirements.txt', 'text')]).toLowerCase();
    if (manager === 'uv') { addStack('uv'); add('uv sync', 'Sync the project environment', 'pyproject.toml', 'install'); }
    else if (manager === 'poetry') { addStack('Poetry'); add('poetry install', 'Install project dependencies', 'pyproject.toml', 'install'); }
    else add(exists('requirements.txt') ? 'python -m pip install -r requirements.txt' : 'python -m pip install -e .', 'Install project dependencies', exists('requirements.txt') ? 'requirements.txt' : 'pyproject.toml', 'install');
    const scripts = { ...python?.project?.scripts, ...python?.tool?.poetry?.scripts };
    for (const name of Object.keys(scripts)) if (/^[\w.-]+$/.test(name)) add(`${run}${name}`, 'Project entry point', 'pyproject.toml', name);
    if (dependencies.includes('pytest') || python?.tool?.pytest || exists('pytest.ini')) { addStack('pytest'); add(`${run}${manager === 'python' ? 'python -m ' : ''}pytest`, 'Run Python tests', 'pyproject.toml', 'test'); }
    if (dependencies.includes('ruff') || python?.tool?.ruff) { addStack('Ruff'); add(`${run}${manager === 'python' ? 'python -m ' : ''}ruff check .`, 'Lint Python source', 'pyproject.toml', 'lint'); }
    if (dependencies.includes('django') && exists('manage.py')) { addStack('Django'); add(`${run}python manage.py runserver`, 'Start the development server', 'manage.py', 'dev'); }
    if (dependencies.includes('fastapi')) addStack('FastAPI');
  }
  const cargo = read('Cargo.toml', 'toml');
  if (cargo) {
    addStack('Rust');
    for (const [command, description] of [['cargo build', 'Build the Rust project'], ['cargo run', 'Run the default binary'], ['cargo test', 'Run Rust tests'], ['cargo check', 'Check without compiling a binary'], ['cargo fmt', 'Format Rust source'], ['cargo clippy', 'Run the Rust linter']]) add(command, description, 'Cargo.toml', command.split(' ')[1]);
  }
  if (exists('go.mod')) { read('go.mod', 'text'); addStack('Go'); add('go build ./...', 'Build all packages', 'go.mod', 'build'); add('go test ./...', 'Test all packages', 'go.mod', 'test'); add('go mod download', 'Download module dependencies', 'go.mod', 'install'); }
  let dotnet; try { dotnet = fs.readdirSync(root).find(name => /\.(csproj|fsproj|sln|slnx)$/i.test(name)); } catch {}
  if (dotnet) { addStack('.NET'); result.sources.push(dotnet); for (const name of ['build', 'test', 'restore']) add(`dotnet ${name}`, `${name[0].toUpperCase() + name.slice(1)} the .NET project`, dotnet, name); }
  return result;
}
function recommend(context, history, line, cwd) {
  if (typeof line !== 'string' || !line.trim() || line.length > 4000 || /[\r\n\x00-\x08\x0b-\x1f]/.test(line)) return [];
  const query = line.trimStart().toLowerCase();
  const candidates = context.commands.filter(item => path.relative(item.cwd, cwd) === '');
  const seen = new Set(candidates.map(item => item.command));
  for (const entry of [...history].reverse()) {
    if (!safeCommand(entry.command) || seen.has(entry.command)) continue;
    seen.add(entry.command); candidates.push({ command: entry.command, description: 'Previously used in this folder', source: 'History', cwd, label: '' });
    if (candidates.length > 200) break;
  }
  const ranked = candidates.map((item, index) => ({ ...item, rank: item.command.toLowerCase().startsWith(query) ? 0 : item.label.toLowerCase().startsWith(query) ? 1 : item.command.toLowerCase().includes(query) ? 2 : 99, index }));
  return ranked.filter(item => item.rank < 99 && item.command !== line).sort((a, b) => a.rank - b.rank || a.index - b.index).slice(0, 6).map(({ rank, index, ...item }) => item);
}
module.exports = { detectProject, findRoot, recommend, safeCommand, within };
