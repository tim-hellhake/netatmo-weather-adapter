#!/bin/bash

rm -rf node_modules
npm ci --production

shasum --algorithm 256 package.json manifest.json lib/*.js views/* LICENSE README.md > SHA256SUMS
find node_modules \( -type f -o -type l \) -exec shasum --algorithm 256 {} \; >> SHA256SUMS

TARFILE=`npm pack`
tar xzf ${TARFILE}
cp -r node_modules ./package
tar czf ${TARFILE} package

shasum --algorithm 256 ${TARFILE} > ${TARFILE}.sha256sum

rm SHA256SUMS
rm -rf package
