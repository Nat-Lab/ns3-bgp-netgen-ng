#!/usr/bin/env node
const fs = require('fs');
const process = require('process');
import NetGen from './netgen';

if (process.argv.length < 3) {
    console.error('usage: ./netgen-cli <config>');
    process.exit(1);
}

var f = fs.readFileSync(process.argv[2], 'utf-8');
var o = JSON.parse(f);
var rslt = NetGen.generate(o);
if (!rslt.ok) {
    rslt.errors.forEach(e => console.error(e));
    process.exit(1);
}

console.log(rslt.code);
process.exit(0);