const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '.build/builtInExtensions/detachhead.basedpyright/package.json');

try {
    let content = fs.readFileSync(packageJsonPath, 'utf8');

    // 修改 importStrategy 默认值为 useBundled
    content = content.replace('"default": "fromEnvironment"', '"default": "useBundled"');

    fs.writeFileSync(packageJsonPath, content, 'utf8');
    console.log('Successfully modified basedpyright package.json');
    console.log('Changed importStrategy default from "fromEnvironment" to "useBundled"');
} catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
}

