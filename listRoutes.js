const listEndpoints = require("express-list-endpoints");
const { Table } = require("console-table-printer");

// Import the Express app (without running the server)
const app = require("./server");

// Log all routes in a table
const routes = listEndpoints(app);
const table = new Table({
  columns: [
    { name: "Method", alignment: "left", color: "cyan" },
    { name: "Path", alignment: "left", color: "green" },
  ],
});

routes.forEach((route) => {
  route.methods.forEach((method) => {
    table.addRow({ Method: method, Path: route.path });
  });
});

console.log("\nExpress Routes:");
table.printTable(); // ✅ Logs routes in a table
