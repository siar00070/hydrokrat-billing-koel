const fs = require('fs');
const path = require('path');

function createLocalConfig(userDataPath) {
  const configFile = path.join(userDataPath, 'hv-local-config.json');

  function read() {
    try {
      return JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    } catch {
      return {};
    }
  }

  function write(data) {
    fs.writeFileSync(configFile, JSON.stringify(data, null, 2));
  }

  return {
    getBranchName() {
      return read().branchName || '';
    },
    setBranchName(name) {
      const data = read();
      data.branchName = name || '';
      write(data);
      return data.branchName;
    }
  };
}

module.exports = { createLocalConfig };
