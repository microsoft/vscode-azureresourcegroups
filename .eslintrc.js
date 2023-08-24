module.exports = {
    "extends": "@microsoft/eslint-config-azuretools",
    "rules": {
        "no-restricted-imports": ["error", {
            patterns: [
                {
                    group: ["*api/docs*"],
                    message: "Don't import from docs. Import from src instead."
                }
            ]
        }],
    }
};
