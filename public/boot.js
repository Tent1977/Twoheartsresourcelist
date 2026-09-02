/*
 * boot.js — a 30-line CommonJS loader.
 *
 * The analysis modules in src/sightline are plain CommonJS, unit-tested under
 * Node. Rather than duplicate them for the browser or add a bundler, the server
 * serves them verbatim at /lib/ and this shim gives them the module/exports/
 * require they expect. One implementation, tested once.
 */

(function () {
  'use strict';

  const factories = {};
  const cache = {};

  function normalise(name) {
    return String(name).replace(/^\.\//, '').replace(/\.js$/, '');
  }

  function require(name) {
    const key = normalise(name);
    if (cache[key]) return cache[key].exports;
    const factory = factories[key];
    if (!factory) throw new Error(`Sightline module not loaded: ${key}`);
    const module = { exports: {} };
    cache[key] = module;
    factory(module, module.exports, require);
    return module.exports;
  }

  async function load(names) {
    const sources = await Promise.all(names.map(async (name) => {
      const res = await fetch(`/lib/${name}.js`);
      if (!res.ok) throw new Error(`could not load ${name}.js (${res.status})`);
      return [name, await res.text()];
    }));
    sources.forEach(([name, src]) => {
      // eslint-disable-next-line no-new-func
      factories[name] = new Function('module', 'exports', 'require', src);
    });
    return require;
  }

  window.Sightline = { load, require };
})();
