const fs = require("fs");
const key = fs.readFileSync("./red--aid-firebase-admin-key.json", "utf8");
const base64 = Buffer.from(key).toString("base64");
console.log(key);
console.log(base64);
console.log();