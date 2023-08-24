module.exports = {
    "extends": "@microsoft/eslint-config-azuretools",
    "rules": {
        "no-restricted-imports": ["error", { "patterns": ["*api/docs*"] }],
    }
};
