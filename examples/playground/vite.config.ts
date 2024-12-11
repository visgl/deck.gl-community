import { defineConfig } from 'vite';
import fs from 'fs';

/** Run against local source */
const getAliases = async (frameworkName, frameworkRootDir) => {
  const modules = await fs.promises.readdir(`${frameworkRootDir}/modules`)
  const aliases = {}
  modules.forEach(module => {
    aliases[`${frameworkName}/${module}`] = `${frameworkRootDir}/modules/${module}/src`;
  })
  // console.log(aliases);
  return aliases
}

const alias = await getAliases('@deck.gl-community', `${__dirname}/../..`);

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  resolve: {alias},
  server: {open: true},
  // define: {
  //   'process.env.GoogleMapsAPIKey': JSON.stringify(process.env.GoogleMapsAPIKey)
  // }
}))
