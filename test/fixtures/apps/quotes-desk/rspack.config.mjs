import path from "node:path";
import { CopyRspackPlugin, HtmlRspackPlugin, container } from "@rspack/core";

const root = import.meta.dirname;

// A Module Federation host whose remote, quotesPanel, is addressed at the
// development server its team runs on 127.0.0.1:9311. Nothing listens there
// once it's built, so the page shows "Quotes unavailable" unless the remote
// is routed to a build that has it.
const config = {
  entry: path.resolve(root, "src/index.js"),
  output: {
    clean: true,
    filename: "[name].[contenthash].js",
    path: path.resolve(root, "dist"),
    publicPath: "auto",
    uniqueName: "quotesDesk",
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
      name: "quotesDesk",
      remotes: {
        quotesPanel: "quotesPanel@http://127.0.0.1:9311/remoteEntry.js",
      },
      shared: {
        react: { singleton: true, requiredVersion: "19.3.1" },
        "react-dom": { singleton: true, requiredVersion: "19.3.1" },
        "@salt-ds/core": { singleton: true, requiredVersion: "1.75.0" },
      },
    }),
    new HtmlRspackPlugin({ template: path.resolve(root, "src/index.html") }),
    new CopyRspackPlugin({ patterns: [{ from: path.resolve(root, "src/sw.js"), to: "sw.js" }] }),
  ],
};

export default config;
