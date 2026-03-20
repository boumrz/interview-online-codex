import { defineConfig } from "@rspack/cli";
import rspack from "@rspack/core";
import path from "node:path";

const isBuildCommand = process.argv.includes("build");

export default defineConfig({
  mode: isBuildCommand ? "production" : "development",
  entry: "./src/main.tsx",
  output: {
    path: path.resolve(process.cwd(), "dist"),
    publicPath: "/"
  },
  devServer: {
    port: 5173,
    historyApiFallback: true,
    proxy: [
      {
        context: ["/api"],
        target: process.env.DEV_API_PROXY_TARGET ?? "http://localhost:8080",
        changeOrigin: true
      },
      {
        context: ["/ws/rooms"],
        target: process.env.DEV_WS_PROXY_TARGET ?? "http://localhost:8080",
        changeOrigin: true,
        ws: true
      }
    ]
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
      "process.env.FEATURE_AGENT_OPS": JSON.stringify(process.env.FEATURE_AGENT_OPS ?? "false"),
      "process.env.VITE_API_BASE_URL": JSON.stringify(process.env.VITE_API_BASE_URL ?? "/api"),
      "process.env.VITE_WS_BASE_URL": JSON.stringify(process.env.VITE_WS_BASE_URL ?? "")
    }),
    new rspack.HtmlRspackPlugin({
      template: "./public/index.html"
    }),
    new rspack.CopyRspackPlugin({
      patterns: [
        {
          from: path.resolve(process.cwd(), "public"),
          to: path.resolve(process.cwd(), "dist"),
          globOptions: {
            ignore: ["**/index.html"]
          }
        }
      ]
    }),
    new rspack.CssExtractRspackPlugin()
  ]
});
