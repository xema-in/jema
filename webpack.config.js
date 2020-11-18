const path = require('path');

const libName = 'Jema';

function getConfig(env) {
    const config = {
        entry: './src/index.ts',
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    use: 'ts-loader',
                    exclude: /node_modules/,
                }
            ]
        },
        resolve: {
            extensions: ['.ts', '.js'],
        },
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: env === 'production' ? `${libName.toLowerCase()}.min.js` : `${libName.toLowerCase()}.js`,
            library: libName
        },
        optimization: {
            minimize: env === 'production' ? true : false,
        },
    };

    return config;
}

module.exports = [
    // getConfig('development'),
    getConfig('production'),
];
