const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  entry: {
    main: './public/js/quiz-game-optimized.js',
    errorHandler: './public/js/modules/error-handler.js',
    contentModerator: './public/js/modules/content-moderator.js'
  },
  output: {
    filename: '[name].[contenthash].js',
    path: path.resolve(__dirname, 'public/dist'),
    clean: true,
    publicPath: '/dist/'
  },
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
        },
        firebase: {
          test: /firebase/,
          name: 'firebase',
          chunks: 'all',
          priority: 10
        },
        common: {
          name: 'common',
          minChunks: 2,
          chunks: 'all',
          enforce: true
        }
      }
    },
    usedExports: true,
    sideEffects: false
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                targets: {
                  browsers: ['> 1%', 'last 2 versions']
                },
                modules: false,
                useBuiltIns: 'usage',
                corejs: 3
              }]
            ]
          }
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production')
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'public/js'),
      '@modules': path.resolve(__dirname, 'public/js/modules')
    }
  },
  devtool: 'source-map'
}; 