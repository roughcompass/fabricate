import path from "node:path";
import { CopyRspackPlugin, HtmlRspackPlugin, container } from "@rspack/core";

const root = import.meta.dirname;

// A Module Federation remote, quotesPanel, that exposes ./Quotes. Its own
// page renders the exposed module on its own, and ticker.js, a single-spa
// application loaded through an import map, is copied beside it.
const config = {
  entry: path.resolve(root, "src/index.js"),
  output: {
    clean: true,
    filename: "[name].[contenthash].js",
    path: path.resolve(root, "dist"),
    publicPath: "auto",
    uniqueName: "quotesPanel",
  },
  resolve: {
    extensions: [".jsx", ".js"],
  },
  experiments: {
    css: true,
  },
  module: {
    rules: [
      {
        test: /\.jsx$/,
        use: [
          {
            loader: "builtin:swc-loader",
            options: {
              jsc: {
                parser: { syntax: "ecmascript", jsx: true },
                transform: { react: { runtime: "automatic" } },
              },
            },
          },
        ],
        type: "javascript/auto",
      },
      {
        test: /\.css$/,
        type: "css",
      },
    ],
  },
  plugins: [
    new container.ModuleFederationPluginV1({
      name: "quotesPanel",
      filename: "remoteEntry.js",
      exposes: {
        "./Quotes": "./src/Quotes.jsx",
      },
      shared: {
        react: { singleton: true, requiredVersion: "19.3.1" },
        "react-dom": { singleton: true, requiredVersion: "19.3.1" },
        "@salt-ds/core": { singleton: true, requiredVersion: "1.75.0" },
      },
    }),
    new HtmlRspackPlugin({ template: path.resolve(root, "src/index.html") }),
    new CopyRspackPlugin({ patterns: [{ from: path.resolve(root, "src/ticker.js"), to: "ticker.js" }] }),
  ],
};

export default config;
