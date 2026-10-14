const { readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const vm = require('node:vm');
const root = resolve(__dirname, '..');
const sourcePaths = {
  'engine.js': 'src/core/engine.js',
  'extractor.js': 'src/features/threads/extractor.js',
  'profile.js': 'src/features/profile/profile.js',
  'dashboard.js': 'src/features/cases/dashboard.js',
  'case-store.js': 'src/features/cases/case-store.js',
  'discord.js': 'src/features/discord/discord.js',
  'teams.js': 'src/features/teams/teams.js',
  'report.js': 'src/features/reports/report.js',
  'background.js': 'src/platform/background/background.js',
  'offscreen.js': 'src/platform/offscreen/offscreen.js',
  'popup.js': 'src/ui/popup/popup.js',
  'popup.html': 'src/ui/popup/popup.html',
  'popup.css': 'src/ui/popup/popup.css'
};
const sourcePath = (name) => resolve(root, sourcePaths[name] || name);
const source = (name) => readFileSync(sourcePath(name), 'utf8');
function htmlScripts(name) {
  return [...source(name).matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)]
    .map((match) => resolve(dirname(sourcePath(name)), match[1]));
}
function loadPopup(context) {
  for (const path of htmlScripts('popup.html'))
    vm.runInContext(readFileSync(path, 'utf8'), context, { filename: path });
  const app = vm.runInContext('app', context);
  // Existing regression scenarios now exercise the explicit public app interface.
  for (const name of ['readThread', 'loadThread', 'refreshSavedCases', 'renderCases', 'extractForumThread']) {
    Object.defineProperty(context, name, {
      configurable: true, get: () => app[name], set: (value) => { app[name] = value; }
    });
  }
  return app;
}
module.exports = { root, sourcePaths, sourcePath, source, htmlScripts, loadPopup };
