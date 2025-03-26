const { Client } = require('guilded.js');
const client = new Client({ token: 'gapi_p250JWJU+F/HVxIeYU6y50vi42LdreYxMf3e6wr42qIkgl2Gfd9epaihrFNEPNnojuNlJdg82awGAsh4SjU5WA==' });
const fs = require('fs');

const attendanceChannelId = '2a41589e-d9a7-4c51-9ddb-a2351a2fbe7e';
const calendarChannelId = '98fb5e68-bebd-44ad-8c65-ade71f56df14';
const subjects = ['math', 'phy', 'c', 'mech', 'plab', 'clab', 'kan', 'sub1'];
let attendanceData = {};
let isTracking = false;
let commandHistory = {}; // For !undo functionality

client.on('ready', () => {
    console.log('Bot is ready!');
    loadAttendanceData();
    loadTrackingState();
    setInterval(checkAndMarkAttendance, 60 * 1000); // Check every minute
});

function loadAttendanceData() {
    if (fs.existsSync('attendance.json')) {
        attendanceData = JSON.parse(fs.readFileSync('attendance.json'));
    } else {
        console.log('Created new attendance.json...');
        saveAttendanceData();
    }
}

function saveAttendanceData() {
    fs.writeFileSync('attendance.json', JSON.stringify(attendanceData, null, 2));
}

function loadTrackingState() {
    if (fs.existsSync('tracking.json')) {
        const data = JSON.parse(fs.readFileSync('tracking.json'));
        isTracking = data.isTracking || false;
    }
    console.log(`Loaded tracking state: ${isTracking}`);
}

function saveTrackingState() {
    fs.writeFileSync('tracking.json', JSON.stringify({ isTracking }, null, 2));
}

async function checkAndMarkAttendance() {
    console.log(`isTracking: ${isTracking}`);
    if (!isTracking) return;

    const now = new Date();
    console.log(`Current time on bot: ${now.toISOString()} (IST: ${now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })})`);

    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const channel = await client.channels.fetch(calendarChannelId);
    const events = await channel.calendarEvents.fetch({ startDate: startOfDay });

    for (const event of events) {
        console.log(`Event: ${event.name}, Starts: ${event.startsAt}, Ends: ${event.endsAt}`);
        const eventStart = new Date(event.startsAt);
        const eventEnd = new Date(event.endsAt);
        if (now >= eventStart && now <= eventEnd) {
            const subject = subjects.find(sub => event.name.toLowerCase().includes(sub));
            console.log(`Detected subject: ${subject}`);
            if (subject) {
                for (const userId in attendanceData) {
                    if (!attendanceData[userId][subject]) {
                        attendanceData[userId][subject] = { present: 0, total: 0, dates: {} };
                    }
                    const dateKey = eventStart.toISOString().split('T')[0];
                    if (!attendanceData[userId][subject].dates[dateKey]) {
                        attendanceData[userId][subject].dates[dateKey] = true;
                        attendanceData[userId][subject].present++;
                        attendanceData[userId][subject].total++;
                        console.log(`Marked ${userId} as present for ${subject} on ${dateKey}`);
                    }
                }
                saveAttendanceData();
            }
        }
    }
}

client.on('messageCreated', async message => {
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).split(' ');
    const command = args[0].toLowerCase();
    let targetUserId = message.authorId;

    // Check for mentioned user
    if (args[1] && args[1].startsWith('<@') && args[1].endsWith('>')) {
        targetUserId = args[1].slice(2, -1);
    }

    if (!attendanceData[targetUserId]) {
        attendanceData[targetUserId] = {};
        subjects.forEach(subject => {
            attendanceData[targetUserId][subject] = { present: 0, total: 0, dates: {} };
        });
    }

    // Fetch the attendance channel to send replies
    const attendanceChannel = await client.channels.fetch(attendanceChannelId);

    if (command === 'startcount') {
        isTracking = true;
        saveTrackingState();
        await attendanceChannel.send('Attendance tracking started!');
    }

    if (command === 'stopcount') {
        isTracking = false;
        saveTrackingState();
        attendanceData = {};
        subjects.forEach(subject => {
            attendanceData[targetUserId][subject] = { present: 0, total: 0, dates: {} };
        });
        saveAttendanceData();
        await attendanceChannel.send('Attendance tracking paused! All data has been reset.');
    }

    if (command === 'help') {
        const helpMessage = `
**Attendance Bot Commands:**

- **!startcount**: Start tracking attendance (use before college begins).
- **!stopcount**: Pause tracking attendance (also resets all data).
- **!abb [@user]**: Mark absent for all classes today (e.g., !abb or !abb @Friend).
- **!abbDDMMYYYY [@user]**: Mark absent for all classes on a specific date (e.g., !abb25032025 for 25/03/2025).
- **!abb<subject> [@user]**: Mark absent for one subject, present for others (e.g., !abbmath or !abbmath @Friend).
- **!abbrest [@user]**: Mark absent for remaining classes today based on current time.
- **!extra [@user] <subject>**: Add an extra class (e.g., !extra math).
- **!att<subject> [@user]**: Check attendance for a subject (e.g., !attmath or !attmath @Friend).
- **!att [@user]**: Show all subjects' attendance in a neat box.
- **!undo**: Undo the last command (works for !abb, !extra, !abb<subject>, !abbrest, !abbDDMMYYYY).
- **!help**: Show this list of commands.
- **!when [@user]**: Show dates when you were absent.
- **Subjects**: ${subjects.join(', ')} (update sub1 later).
        `;
        await attendanceChannel.send(helpMessage);
    }

    if (command === 'att') {
        let response = 'Your Attendance:\n';
        let hasData = false;
        for (const subject of subjects) {
            const data = attendanceData[targetUserId][subject];
            if (data && data.total > 0) {
                hasData = true;
                const percentage = (data.present / data.total) * 100;
                const status = percentage >= 75 ? '✅ Eligible' : '⚠️ Not Eligible';
                response += `**${subject}**: ${percentage.toFixed(2)}% (${data.present}/${data.total}) ${status}\n`;
            }
        }
        if (!hasData) {
            response = 'You have no attendance data yet.';
        }
        await attendanceChannel.send(response);
    }

    if (command.startsWith('att') && subjects.includes(command.slice(3))) {
        const subject = command.slice(3);
        const data = attendanceData[targetUserId][subject];
        if (data && data.total > 0) {
            const percentage = (data.present / data.total) * 100;
            const status = percentage >= 75 ? '✅ Eligible' : '⚠️ Not Eligible';
            await attendanceChannel.send(`**${subject}**: ${percentage.toFixed(2)}% (${data.present}/${data.total}) ${status}`);
        } else {
            await attendanceChannel.send(`No attendance data for **${subject}** yet.`);
        }
    }

    if (command === 'abb') {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const channel = await client.channels.fetch(calendarChannelId);
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const events = await channel.calendarEvents.fetch({ startDate: startOfDay });

        const previousState = JSON.parse(JSON.stringify(attendanceData[targetUserId]));
        for (const event of events) {
            const eventStart = new Date(event.startsAt);
            const eventDate = eventStart.toISOString().split('T')[0];
            if (eventDate === today) {
                const subject = subjects.find(sub => event.name.toLowerCase().includes(sub));
                if (subject) {
                    if (!attendanceData[targetUserId][subject]) {
                        attendanceData[targetUserId][subject] = { present: 0, total: 0, dates: {} };
                    }
                    const dateKey = eventStart.toISOString().split('T')[0];
                    if (!attendanceData[targetUserId][subject].dates[dateKey]) {
                        attendanceData[targetUserId][subject].dates[dateKey] = false;
                        attendanceData[targetUserId][subject].total++;
                    } else if (attendanceData[targetUserId][subject].dates[dateKey]) {
                        attendanceData[targetUserId][subject].dates[dateKey] = false;
                        attendanceData[targetUserId][subject].present--;
                    }
                }
            }
        }
        saveAttendanceData();
        commandHistory[targetUserId] = { command: 'abb', previousState };
        await attendanceChannel.send('Marked absent for all classes today.');
    }

    if (command.startsWith('abb') && /^\d{8}$/.test(command.slice(3))) {
        const dateStr = command.slice(3);
        const day = dateStr.slice(0, 2);
        const month = dateStr.slice(2, 4);
        const year = dateStr.slice(4);
        const targetDate = `${year}-${month}-${day}`;
        const channel = await client.channels.fetch(calendarChannelId);
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);
        const events = await channel.calendarEvents.fetch({ startDate: startOfDay, endDate: endOfDay });

        const previousState = JSON.parse(JSON.stringify(attendanceData[targetUserId]));
        for (const event of events) {
            const eventStart = new Date(event.startsAt);
            const eventDate = eventStart.toISOString().split('T')[0];
            if (eventDate === targetDate) {
                const subject = subjects.find(sub => event.name.toLowerCase().includes(sub));
                if (subject) {
                    if (!attendanceData[targetUserId][subject]) {
                        attendanceData[targetUserId][subject] = { present: 0, total: 0, dates: {} };
                    }
                    const dateKey = eventStart.toISOString().split('T')[0];
                    if (!attendanceData[targetUserId][subject].dates[dateKey]) {
                        attendanceData[targetUserId][subject].dates[dateKey] = false;
                        attendanceData[targetUserId][subject].total++;
                    } else if (attendanceData[targetUserId][subject].dates[dateKey]) {
                        attendanceData[targetUserId][subject].dates[dateKey] = false;
                        attendanceData[targetUserId][subject].present--;
                    }
                }
            }
        }
        saveAttendanceData();
        commandHistory[targetUserId] = { command: `abb${dateStr}`, previousState };
        await attendanceChannel.send(`Marked absent for all classes on ${day}/${month}/${year}.`);
    }

    if (command.startsWith('abb') && subjects.includes(command.slice(3))) {
        const subject = command.slice(3);
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const channel = await client.channels.fetch(calendarChannelId);
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const events = await channel.calendarEvents.fetch({ startDate: startOfDay });

        const previousState = JSON.parse(JSON.stringify(attendanceData[targetUserId]));
        let marked = false;
        for (const event of events) {
            const eventStart = new Date(event.startsAt);
            const eventDate = eventStart.toISOString().split('T')[0];
            if (eventDate === today && event.name.toLowerCase().includes(subject)) {
                if (!attendanceData[targetUserId][subject]) {
                    attendanceData[targetUserId][subject] = { present: 0, total: 0, dates: {} };
                }
                const dateKey = eventStart.toISOString().split('T')[0];
                if (!attendanceData[targetUserId][subject].dates[dateKey]) {
                    attendanceData[targetUserId][subject].dates[dateKey] = false;
                    attendanceData[targetUserId][subject].total++;
                } else if (attendanceData[targetUserId][subject].dates[dateKey]) {
                    attendanceData[targetUserId][subject].dates[dateKey] = false;
                    attendanceData[targetUserId][subject].present--;
                }
                marked = true;
            } else if (eventDate === today) {
                const otherSubject = subjects.find(sub => event.name.toLowerCase().includes(sub));
                if (otherSubject && otherSubject !== subject) {
                    if (!attendanceData[targetUserId][otherSubject]) {
                        attendanceData[targetUserId][otherSubject] = { present: 0, total: 0, dates: {} };
                    }
                    const dateKey = eventStart.toISOString().split('T')[0];
                    if (!attendanceData[targetUserId][otherSubject].dates[dateKey]) {
                        attendanceData[targetUserId][otherSubject].dates[dateKey] = true;
                        attendanceData[targetUserId][otherSubject].present++;
                        attendanceData[targetUserId][otherSubject].total++;
                    }
                }
            }
        }
        if (marked) {
            saveAttendanceData();
            commandHistory[targetUserId] = { command: `abb${subject}`, previousState };
            await attendanceChannel.send(`Marked absent for **${subject}** today, present for others.`);
        } else {
            await attendanceChannel.send(`No **${subject}** class found today.`);
        }
    }

    if (command === 'abbrest') {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const channel = await client.channels.fetch(calendarChannelId);
        const events = await channel.calendarEvents.fetch({ startDate: now });

        const previousState = JSON.parse(JSON.stringify(attendanceData[targetUserId]));
        for (const event of events) {
            const eventStart = new Date(event.startsAt);
            const eventDate = eventStart.toISOString().split('T')[0];
            if (eventStart > now && eventDate === today) {
                const subject = subjects.find(sub => event.name.toLowerCase().includes(sub));
                if (subject) {
                    if (!attendanceData[targetUserId][subject]) {
                        attendanceData[targetUserId][subject] = { present: 0, total: 0, dates: {} };
                    }
                    const dateKey = eventStart.toISOString().split('T')[0];
                    if (!attendanceData[targetUserId][subject].dates[dateKey]) {
                        attendanceData[targetUserId][subject].dates[dateKey] = false;
                        attendanceData[targetUserId][subject].total++;
                        console.log(`Marked ${targetUserId} as absent for ${subject} on ${dateKey}`);
                    }
                }
            }
        }
        saveAttendanceData();
        commandHistory[targetUserId] = { command: 'abbrest', previousState };
        await attendanceChannel.send('Marked absent for remaining classes today.');
    }

    if (command === 'extra' && args[2] && subjects.includes(args[2].toLowerCase())) {
        const subject = args[2].toLowerCase();
        const now = new Date();
        const dateKey = now.toISOString().split('T')[0];

        const previousState = JSON.parse(JSON.stringify(attendanceData[targetUserId]));
        if (!attendanceData[targetUserId][subject]) {
            attendanceData[targetUserId][subject] = { present: 0, total: 0, dates: {} };
        }
        if (!attendanceData[targetUserId][subject].dates[dateKey]) {
            attendanceData[targetUserId][subject].dates[dateKey] = true;
            attendanceData[targetUserId][subject].present++;
            attendanceData[targetUserId][subject].total++;
            saveAttendanceData();
            commandHistory[targetUserId] = { command: `extra ${subject}`, previousState };
            await attendanceChannel.send(`Added an extra **${subject}** class for today.`);
        } else {
            await attendanceChannel.send(`An entry for **${subject}** on ${dateKey} already exists.`);
        }
    }

    if (command === 'undo') {
        if (!commandHistory[targetUserId]) {
            await attendanceChannel.send('No previous command to undo.');
            return;
        }
        const { command: lastCommand, previousState } = commandHistory[targetUserId];
        attendanceData[targetUserId] = previousState;
        saveAttendanceData();
        delete commandHistory[targetUserId];
        await attendanceChannel.send(`Undid the last command: **${lastCommand}**.`);
    }

    if (command === 'when') {
        let response = 'Dates when you were absent:\n';
        let hasAbsences = false;
        for (const subject of subjects) {
            const data = attendanceData[targetUserId][subject];
            if (data && data.dates) {
                const absentDates = Object.keys(data.dates).filter(date => !data.dates[date]);
                if (absentDates.length > 0) {
                    hasAbsences = true;
                    response += `**${subject}**: ${absentDates.join(', ')}\n`;
                }
            }
        }
        if (!hasAbsences) {
            response = 'You have no recorded absences.';
        }
        await attendanceChannel.send(response);
    }
});

client.login();