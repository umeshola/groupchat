import express from 'express';
import { WebSocketServer } from 'ws';
import fs from 'fs';

// Initialize an Express application and WebSocket server
const app = express();
const httpServer = app.listen(8080);
const wss = new WebSocketServer({ server: httpServer });

// Path to db.json file
const dbFilePath = './db.json';

// Helper function to read the database file
function readDb() {
    const data = fs.readFileSync(dbFilePath, 'utf8');
    return JSON.parse(data);
}

// Helper function to write to the database file (excluding WebSocket objects)
function writeDb(data) {
    const dbCopy = { users: {}, groups: data.groups };

    // Only store user IDs in db.json (not WebSocket objects)
    Object.keys(data.users).forEach((userID) => {
        dbCopy.users[userID] = { userID };
    });

    fs.writeFileSync(dbFilePath, JSON.stringify(dbCopy, null, 2));
}

// Initialize user count and an in-memory map for active connections
let count = 0;
const activeConnections = {};

// Handle new WebSocket connections
wss.on('connection', (ws) => {
    count += 1;
    const userID = `user${count}`;
    activeConnections[userID] = ws;

    // Log new connection
    console.log(`New connection: ${userID}`);

    // Initialize user in the database
    let db = readDb();
    db.users[userID] = { userID };
    db.groups = db.groups || {}; // Ensure groups object exists if undefined
    writeDb(db);
    ws.send(JSON.stringify({ user: userID }));

    ws.on('message', (data) => {
        const message = JSON.parse(data);

        if (message.type === 'sendToUser') {
            const targetWs = activeConnections[message.userID];
            if (targetWs && targetWs.readyState === ws.OPEN) {
                targetWs.send(JSON.stringify({ from: userID, message: message.content }));
            } else {
                ws.send(`User ${message.userID} not found`);
            }

        } else if (message.type === 'sendToGroup') {
            const groupID = message.groupID;
            const groupUsers = db.groups[groupID] || [];
            console.log(`Broadcasting message to group ${groupID}:`, groupUsers);

            groupUsers.forEach((groupUserID) => {
                const targetWs = activeConnections[groupUserID];
                if (targetWs && targetWs.readyState === ws.OPEN && groupUserID !== userID) {
                    targetWs.send(JSON.stringify({ from: userID, message: message.content }));
                    console.log(`Message sent to ${groupUserID}`);
                } else {
                    console.log(`Skipping user ${groupUserID} (not connected or is sender)`);
                }
            });

        } else if (message.type === 'joinGroup') {
            const groupID = message.groupID;
            db = readDb();
            db.groups[groupID] = db.groups[groupID] || [];

            if (!db.groups[groupID].includes(userID)) {
                db.groups[groupID].push(userID);
                writeDb(db);
                console.log(`${userID} joined group ${groupID}`);
            } else {
                console.log(`${userID} is already in group ${groupID}`);
            }
        }
    });

    ws.on('close', () => {
        db = readDb();
        delete db.users[userID];
        delete activeConnections[userID];

        for (const groupID in db.groups) {
            db.groups[groupID] = db.groups[groupID].filter(id => id !== userID);
            if (db.groups[groupID].length === 0) {
                delete db.groups[groupID];
            }
        }

        writeDb(db);
        console.log(`User ${userID} disconnected`);
    });

    ws.on('error', console.error);
});