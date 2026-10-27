// Remotion Studio (`vitrin video --studio`): the sources use NodeNext-style `.js` specifiers that point at .ts/.tsx
// files, as in the renderer's bundle() call.
import { Config } from '@remotion/cli/config';

Config.overrideWebpackConfig((c) => ({ ...c, resolve: { ...c.resolve, extensionAlias: { '.js': ['.ts', '.tsx', '.js'] } } }));
