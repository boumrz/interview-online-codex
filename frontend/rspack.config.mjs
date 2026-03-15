import { defineConfig } from "@rspack/cli";
import rspack from "@rspack/core";
import path from "node:path";

export default defineConfig({
  mode: "development",
  entry: "./src/main.tsx",
  output: {
    path: path.resolve(process.cwd(), "dist"),
    publicPath: "/"
  },
  devServer: {
    port: 5173,
    historyApiFallback: true
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"]
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "builtin:swc-loader",
        type: "javascript/auto"
      },
      {
        test: /\.css$/,
        oneOf: [
          {
            test: /\.module\.css$/,
            use: [
              rspack.CssExtractRspackPlugin.loader,
              {
                loader: "css-loader",
                options: {
                  modules: {
                    namedExport: false
                  }
                }
              }
            ]
          },
          {
            use: [rspack.CssExtractRspackPlugin.loader, "css-loader"]
          }
        ]
      }
    ]
  },
  plugins: [
    new rspack.DefinePlugin({
      __FEATURE_AGENT_OPS__: JSON.stringify(process.env.FEATURE_AGENT_OPS ?? "false"),
      "process.env.FEATURE_AGENT_OPS": JSON.stringify(process.env.FEATURE_AGENT_OPS ?? "false")
    }),
    new rspack.HtmlRspackPlugin({
      template: "./public/index.html"
    }),
    new rspack.CssExtractRspackPlugin()
  ]
});
