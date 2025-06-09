#!/usr/bin/env node

const { exec } = require('child_process');
const os = require('os');

const ports = [3000, 5678, 5679, 5680];

function findAndKillProcessOnPort(port) {
  let command;
  
  if (os.platform() === 'win32') {
    // Windows
    command = `netstat -ano | findstr :${port} | findstr LISTENING`;
  } else {
    // macOS, Linux, etc.
    command = `lsof -i :${port} | grep LISTEN`;
  }

  console.log(`Checking for processes using port ${port}...`);
  
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.log(`No process found using port ${port}`);
      return;
    }

    if (stdout) {
      let pid;
      
      if (os.platform() === 'win32') {
        // Windows format: Extract PID from the last column
        const lines = stdout.trim().split('\n');
        if (lines.length > 0) {
          const parts = lines[0].trim().split(/\s+/);
          pid = parts[parts.length - 1];
        }
      } else {
        // Unix format: Extract PID from the second column
        const lines = stdout.trim().split('\n');
        if (lines.length > 0) {
          // Column format is: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
          const parts = lines[0].trim().split(/\s+/);
          pid = parts[1];
        }
      }

      if (pid) {
        console.log(`Found process using port ${port} with PID: ${pid}`);
        
        // Kill the process
        const killCmd = os.platform() === 'win32' ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`;
        
        exec(killCmd, (killError, killStdout, killStderr) => {
          if (killError) {
            console.error(`Error killing process on port ${port}:`, killStderr);
          } else {
            console.log(`Successfully killed process on port ${port} with PID: ${pid}`);
          }
        });
      } else {
        console.log(`Could not extract PID for port ${port}`);
      }
    }
  });
}

// Check each port
ports.forEach(port => {
  findAndKillProcessOnPort(port);
});

console.log('Port cleanup process initiated. You can now start the server.');

// Function to kill processes on specific ports
function killProcessOnPort(port) {
  return new Promise((resolve, reject) => {
    exec(`lsof -ti:${port}`, (error, stdout, stderr) => {
      if (error) {
        console.log(`No process found on port ${port}`);
        resolve();
        return;
      }
      
      const pids = stdout.trim().split('\n').filter(pid => pid);
      if (pids.length === 0) {
        console.log(`No process found on port ${port}`);
        resolve();
        return;
      }
      
      console.log(`Found ${pids.length} process(es) on port ${port}: ${pids.join(', ')}`);
      
      // Kill each process
      const killPromises = pids.map(pid => {
        return new Promise((killResolve) => {
          exec(`kill -9 ${pid}`, (killError) => {
            if (killError) {
              console.error(`Failed to kill process ${pid}:`, killError.message);
            } else {
              console.log(`Successfully killed process ${pid}`);
            }
            killResolve();
          });
        });
      });
      
      Promise.all(killPromises).then(() => {
        console.log(`Finished cleaning up port ${port}`);
        resolve();
      });
    });
  });
}

// Main function
async function main() {
  const ports = process.argv.slice(2);
  
  if (ports.length === 0) {
    console.log('Usage: node scripts/kill-ports.js <port1> [port2] [port3] ...');
    console.log('Example: node scripts/kill-ports.js 5678 5679 5680');
    process.exit(1);
  }
  
  console.log(`Cleaning up processes on ports: ${ports.join(', ')}`);
  
  for (const port of ports) {
    await killProcessOnPort(port);
  }
  
  console.log('Port cleanup completed!');
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { killProcessOnPort }; 