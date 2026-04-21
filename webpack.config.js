const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

const commonConfig = {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.node$/,
        loader: 'node-loader',
        options: {
          name: '[name].[ext]'
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.ttf$/,
        use: ['file-loader']
      }
    ]
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.json', '.node'],
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  node: {
    __dirname: false,
    __filename: false
  }
};

const mainConfig = {
  ...commonConfig,
  target: 'electron-main',
  entry: './src/main.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'main.js'
  },
  plugins: [
    new webpack.IgnorePlugin({ resourceRegExp: /^osx-temperature-sensor$/ }),
    new webpack.IgnorePlugin({ resourceRegExp: /^macos-temperature-sensor$/ })
  ],
  externals: {
    'node-pty-prebuilt-multiarch': 'commonjs node-pty-prebuilt-multiarch',
    'electron': 'commonjs electron'
  }
};

const rendererConfig = {
  ...commonConfig,
  target: 'web',
  entry: ['./src/global-shim.js', './src/index.tsx'],
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'renderer.js'
  },
  resolve: {
    ...commonConfig.resolve,
    fallback: {
      buffer: require.resolve('buffer/'),
      stream: require.resolve('stream-browserify'),
      process: require.resolve('process/browser'),
      fs: false,
      path: require.resolve('path-browserify'),
      events: require.resolve('events/'),
      crypto: false,
      http: require.resolve('stream-http'),
      https: require.resolve('https-browserify'),
      util: require.resolve('util/'),
      url: require.resolve('url/'),
      assert: require.resolve('assert/'),
      zlib: require.resolve('browserify-zlib')
    }
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: 'window.global = window; self.global = self;',
      raw: true,
      entryOnly: true
    }),
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
    }),
    new webpack.ProvidePlugin({
      process: 'process/browser.js',
      Buffer: ['buffer', 'Buffer'],
      global: require.resolve('global')
    }),
    new HtmlWebpackPlugin({
      template: './public/index.html',
      filename: 'index.html',
      inject: 'body'
    }),
    new MonacoWebpackPlugin({
      languages: ['javascript', 'typescript', 'html', 'css', 'json', 'markdown']
    })
  ],
  experiments: {
    topLevelAwait: true
  }
};

rendererConfig.module.rules.push({
  test: /\.m?js/,
  resolve: {
    fullySpecified: false
  }
});

rendererConfig.resolve.alias = {
  ...rendererConfig.resolve.alias,
  '@codingame/monaco-vscode-api$': path.resolve(__dirname, 'node_modules/@codingame/monaco-vscode-api'),
  'process': 'process/browser.js'
};

const firstSetupConfig = {
  ...commonConfig,
  target: 'web',
  entry: ['./src/global-shim.js', './src/firstTimeSetupEntry.tsx'],
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'firstTimeSetup.js'
  },
  resolve: {
    ...commonConfig.resolve,
    fallback: {
      buffer: require.resolve('buffer/'),
      stream: require.resolve('stream-browserify'),
      process: require.resolve('process/browser'),
      fs: false,
      path: require.resolve('path-browserify'),
      events: require.resolve('events/'),
      crypto: false,
      http: require.resolve('stream-http'),
      https: require.resolve('https-browserify'),
      util: require.resolve('util/'),
      url: require.resolve('url/'),
      assert: require.resolve('assert/'),
      zlib: require.resolve('browserify-zlib')
    },
    alias: {
      ...commonConfig.resolve.alias,
      process: 'process/browser.js'
    }
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: 'window.global = window; self.global = self;',
      raw: true,
      entryOnly: true
    }),
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
    }),
    new webpack.ProvidePlugin({
      process: 'process/browser.js',
      Buffer: ['buffer', 'Buffer'],
      global: require.resolve('global')
    }),
    new HtmlWebpackPlugin({
      template: './public/first-time-setup.html',
      filename: 'first-time-setup.html',
      inject: 'body'
    })
  ],
  experiments: {
    topLevelAwait: true
  }
};

firstSetupConfig.module.rules.push({
  test: /\.m?js/,
  resolve: {
    fullySpecified: false
  }
});

const backendPreferenceConfig = {
  ...commonConfig,
  target: 'web',
  entry: ['./src/global-shim.js', './src/backendPreferenceEntry.tsx'],
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'backendPreference.js'
  },
  resolve: {
    ...commonConfig.resolve,
    fallback: {
      buffer: require.resolve('buffer/'),
      stream: require.resolve('stream-browserify'),
      process: require.resolve('process/browser'),
      fs: false,
      path: require.resolve('path-browserify'),
      events: require.resolve('events/'),
      crypto: false,
      http: require.resolve('stream-http'),
      https: require.resolve('https-browserify'),
      util: require.resolve('util/'),
      url: require.resolve('url/'),
      assert: require.resolve('assert/'),
      zlib: require.resolve('browserify-zlib')
    },
    alias: {
      ...commonConfig.resolve.alias,
      process: 'process/browser.js'
    }
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: 'window.global = window; self.global = self;',
      raw: true,
      entryOnly: true
    }),
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
    }),
    new webpack.ProvidePlugin({
      process: 'process/browser.js',
      Buffer: ['buffer', 'Buffer'],
      global: require.resolve('global')
    }),
    new HtmlWebpackPlugin({
      template: './public/backend-preference.html',
      filename: 'backend-preference.html',
      inject: 'body'
    })
  ],
  experiments: {
    topLevelAwait: true
  }
};

backendPreferenceConfig.module.rules.push({
  test: /\.m?js/,
  resolve: {
    fullySpecified: false
  }
});

module.exports = [mainConfig, rendererConfig, firstSetupConfig, backendPreferenceConfig];
