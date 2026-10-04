const fs = require('fs');

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// بناء الـ Trie + إضافة المسافة في الآخر
const trie = {};
for (const method of methods) {
    let node = trie;
    for (const char of method) {
        if (!node[char]) node[char] = {};
        node = node[char];
    }
    // نضيف المسافة كحرف أخير
    if (!node[' ']) node[' '] = {};
    node[' '].$ = method;
}

function generateSwitch(node, depth = 0) {
    const indent = '  '.repeat(depth + 1);
    const pointer = depth === 0 ? 'pointer' : `pointer + ${depth}`;

    let code = `${indent}switch (header[${pointer}]) {\n`;

    for (const key of Object.keys(node)) {
        if (key === '$') continue;

        const hex = key === ' '
            ? '0x20'
            : '0x' + key.charCodeAt(0).toString(16).toUpperCase();

        const comment = key === ' ' ? 'Space' : key;

        code += `${indent}  case ${hex}: // ${comment}\n`;

        if (node[key].$) {
            // وصلنا للمسافة بعد الميثود → نجاح
            const methodName = node[key].$;
            code += `${indent}    parsedData.method = '${methodName}';\n`;
            code += `${indent}    parsedData.pointer = pointer + ${depth + 1};\n`;
            code += `${indent}    break;\n`;
        } else {
            // لسه في حروف
            code += generateSwitch(node[key], depth + 1);
            code += `${indent}    break;\n`;
        }
    }

    code += `${indent}  default:\n`;
    code += `${indent}    socket.destroy();\n`;
    code += `${indent}    break;\n`;
    code += `${indent}}\n`;

    return code;
}

const switchCode = generateSwitch(trie);

const finalCode = `// تم توليده تلقائيًا - ممنوع التعديل اليدوي

module.exports = function parseMethod(header, socket) {
  let pointer = 0;
  let parsedData = { method: null, pointer: 0 };

${switchCode}

  return parsedData;
};
`;

fs.writeFileSync('generated-method-parser.js', finalCode);
console.log('✅ تم توليد الملف بنجاح');