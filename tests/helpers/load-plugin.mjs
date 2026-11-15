import { readFile } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const projectRoot = new URL('../../', import.meta.url);

// 每次加载独立的浏览器上下文；仅外部依赖用 mock，生产模块按真实 import 链接。
export async function loadPlugin(relativePath, globals = {}, mocks = {}) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, URL, AbortController, ...globals });
  const modules = new Map();
  const mockUrls = new Map(Object.entries(mocks).map(([path, exports]) => [new URL(path, projectRoot).href, exports]));
  const rootPath = fileURLToPath(projectRoot);
  function getModule(url) {
    const path = relative(rootPath, fileURLToPath(url));
    if (isAbsolute(path) || path === '..' || path.startsWith('..\\') || path.startsWith('../')) {
      throw new Error('测试拒绝加载项目外模块：' + url.href);
    }
    if (!modules.has(url.href)) {
      modules.set(url.href, (async () => {
        if (mockUrls.has(url.href)) {
          const exports = mockUrls.get(url.href);
          return new vm.SyntheticModule(Object.keys(exports), function () {
            for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
          }, { context, identifier: url.href });
        }
        return new vm.SourceTextModule(await readFile(url, 'utf8'), {
          context,
          identifier: url.href,
          importModuleDynamically: async (specifier, from) => {
            const dep = await getModule(new URL(specifier, from.identifier));
            if (dep.status === 'unlinked') await dep.link(linker);
            if (dep.status === 'linked') await dep.evaluate();
            return dep;
          },
        });
      })());
    }
    return modules.get(url.href);
  }
  function linker(specifier, from) {
    return getModule(new URL(specifier, from.identifier));
  }
  const entry = await getModule(new URL(relativePath, projectRoot));
  await entry.link(linker);
  await entry.evaluate();
  return { namespace: entry.namespace, context };
}
