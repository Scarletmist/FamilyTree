// Only needed when updating the vendored map runtime. Normal site builds need no npm install.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const output = path.resolve(__dirname, '../../src/assets/vendor');
fs.mkdirSync(output, { recursive: true });
esbuild.buildSync({ entryPoints: [path.join(__dirname, 'map-runtime.jsx')], outfile: path.join(output, 'pigeon-map.js'), bundle: true, minify: true, format: 'esm', target: ['es2020'], define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof' });
const licenses = ['pigeon-maps/LICENSE.md', 'react/LICENSE', 'react-dom/LICENSE', 'scheduler/LICENSE'].map(file => {
  const licensePath = file.startsWith('scheduler/')
    ? path.join(path.dirname(require.resolve('scheduler/package.json', { paths: [path.dirname(require.resolve('react-dom'))] })), 'LICENSE')
    : path.join(__dirname, 'node_modules', file);
  return file + '\n' + fs.readFileSync(licensePath, 'utf8');
});
fs.writeFileSync(path.join(output, 'map-LICENSES.txt'), licenses.join('\n\n'));
