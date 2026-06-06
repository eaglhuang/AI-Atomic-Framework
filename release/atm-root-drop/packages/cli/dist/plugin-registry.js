import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export async function readPluginRegistry(cwd) {
    const configPath = path.resolve(cwd, '.atm/config.json');
    if (!existsSync(configPath)) {
        return [];
    }
    try {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        const pluginConfigs = config?.plugins?.externalTaskSources;
        if (!Array.isArray(pluginConfigs)) {
            return [];
        }
        const loaded = [];
        for (const pConfig of pluginConfigs) {
            const { id, packagePath, enabled, mode } = pConfig;
            if (!enabled || mode === 'disabled') {
                continue;
            }
            // Resolve path for dynamic import
            let importPath = packagePath;
            if (packagePath.startsWith('.') || packagePath.startsWith('/') || packagePath.includes(':') || packagePath.startsWith('\\')) {
                importPath = pathToFileURL(path.resolve(cwd, packagePath)).href;
            }
            try {
                const mod = await import(importPath);
                const plugin = mod.default || mod;
                if (plugin && plugin.kind === 'external-task-source' && typeof plugin.id === 'string') {
                    loaded.push({
                        plugin,
                        mode: mode === 'enforce' ? 'enforce' : 'advisory'
                    });
                }
                else {
                    console.warn(`[plugin-registry] Warning: Loaded module from ${packagePath} is not a valid ExternalTaskSourcePlugin.`);
                }
            }
            catch (err) {
                console.error(`[plugin-registry] Error loading plugin ${id} from ${packagePath}:`, err);
            }
        }
        return loaded;
    }
    catch (err) {
        console.error(`[plugin-registry] Error parsing .atm/config.json:`, err);
        return [];
    }
}
