const { Client } = require('guilded.js');
const fs = require('fs');

const client = new Client({ token: 'gapi_p250JWJU+F/HVxIeYU6y50vi42LdreYxMf3e6wr42qIkgl2Gfd9epaihrFNEPNnojuNlJdg82awGAsh4SjU5WA==' });
const attendanceChannelId = '2a41589e-d9a7-4c51-9ddb-a2351a2fbe7e';
const calendarChannelId = '98fb5e68-bebd-44ad-8c65-ade71f56df14';

let isCounting = false;
let lastCommand = null;
let lastProcessedDate = null;
const subjects = ['math', 'phy', 'c', 'mech', 'plab', 'clab', 'kan', 'sub1'];

let attendanceData;
try {
    attendanceData = JSON.parse(fs.readFileSync('attendance.json', 'utf8'));
    console.log('Attendance data loaded...');
} catch (error) {
    if (error.code === 'ENOENT') {
        attendanceData = {};
        fs.writeFileSync('attendance.json', JSON.stringify(attendanceData));
        console.log('Created new attendance.json...');
    } else {
        throw error;
    }
}

function initializeSubjectData() {
    return {
        attended: 0,
        total: 0,
        absentToday: false,
        absentDates: [],
        processedClasses: []
    };
}

function extractUserId(mention) {
    const match = mention.match(/<@!?(\w+)>/);
    return match ? match[1] : null;
}

async function getCalendarEvents(date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    const events = await client.rest.get(`/channels/${calendarChannelId}/events?start_date=${start.toISOString()}&end_date=${end.toISOString()}`);
    console.log('Fetched events for date', date.toLocaleDateString('en-GB'), ':', JSON.stringify(events, null, 2));
    return events;
}

function getStatus(userId) {
    if (!attendanceData[userId] || Object.keys(attendanceData[userId]).length === 0) {
        return 'No attendance data yet!';
    }
    let status = '';
    for (const subject of subjects) {
        if (attendanceData[userId][subject]) {
            const { attended, total } = attendanceData[userId][subject];
            const percentage = total > 0 ? Math.max(0, (attended / total) * 100) : 0;
            status += `**${subject}**: ${percentage.toFixed(2)}% (${attended}/${total})\n`;
        }
    }
    return status || 'No attendance data yet!';
}

async function clearMessages(channelId) {
    const response = await client.rest.get(`/channels/${channelId}/messages?limit=50`);
    const messages = response.messages;
    const instructionMsg = messages.find(msg => msg.content.includes('Attendance Bot Commands'));
    if (instructionMsg) {
        await client.rest.delete(`/channels/${channelId}/messages/${instructionMsg.id}`);
    }
}

async function sendInstructions(channelId) {
    const instructions = `
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
- **Subjects**: math, phy, c, mech, plab, clab, kan, sub1 (update sub1 later).
`;
    await client.rest.post(`/channels/${channelId}/messages`, { content: instructions });
}

async function checkAndMarkAttendance() {
    if (!isCounting) return;

    const today = new Date();
    const todayStr = today.toLocaleDateString('en-GB');
    const now = today.getTime();

    const events = await getCalendarEvents(today);
    const isHoliday = events.calendarEvents.some(e => e.name.toLowerCase().includes('holiday') || e.name.toLowerCase().includes('festival'));
    if (isHoliday) return;

    for (const userId in attendanceData) {
        if (!attendanceData[userId]) continue;

        for (const event of events.calendarEvents) {
            const startTime = new Date(event.startsAt).getTime();
            const subject = event.name.toLowerCase().replace(' class', '').trim();
            if (!subjects.includes(subject)) continue;

            if (!attendanceData[userId][subject]) {
                attendanceData[userId][subject] = initializeSubjectData();
            }

            const eventId = event.id;
            const hasProcessed = attendanceData[userId][subject].processedClasses.some(
                entry => entry.eventId === eventId && entry.date === todayStr
            );

            if (hasProcessed || startTime > now) continue;

            const isAbsentToday = attendanceData[userId][subject].absentToday;
            const hasFullAbsence = attendanceData[userId][subject].absentDates.some(
                entry => entry.date === todayStr && entry.fullAbsence
            );
            const hasSubjectAbsence = attendanceData[userId][subject].absentDates.some(
                entry => entry.date === todayStr && !entry.fullAbsence
            );

            if (!isAbsentToday && !hasFullAbsence && !hasSubjectAbsence) {
                attendanceData[userId][subject].attended += 1;
                attendanceData[userId][subject].total += 1;
                console.log(`Marked ${userId} as present for ${subject} on ${todayStr} at ${event.startsAt}`);
            } else if (hasSubjectAbsence && !hasFullAbsence) {
                attendanceData[userId][subject].total += 1;
                console.log(`Marked ${userId} as absent for ${subject} on ${todayStr} at ${event.startsAt} (subject-specific absence)`);
            } else if (hasFullAbsence) {
                attendanceData[userId][subject].total += 1;
                console.log(`Marked ${userId} as absent for ${subject} on ${todayStr} at ${event.startsAt} (full absence)`);
            }

            attendanceData[userId][subject].processedClasses.push({ eventId, date: todayStr });
        }
    }

    fs.writeFileSync('attendance.json', JSON.stringify(attendanceData));
}

client.on('ready', async () => {
    console.log('Bot is ready!');
    try {
        // Fetch the attendance channel to get the guild ID
        const channel = await client.channels.fetch(attendanceChannelId);
        if (!channel) {
            console.error(`Channel with ID ${attendanceChannelId} not found!`);
            return;
        }

        const guildId = channel.serverId;
        if (!guildId) {
            console.error('Could not determine guild ID from channel!');
            return;
        }

        console.log(`Guild ID for server containing attendance channel: ${guildId}`);

        // Fetch the guild
        const guild = await client.guilds.fetch(guildId);
        if (!guild) {
            console.error(`Guild with ID ${guildId} not found!`);
            return;
        }

        // Fetch all members of the guild
        const members = await guild.members.fetch();
        for (const member of members.values()) {
            const userId = member.id;
            if (!attendanceData[userId]) {
                attendanceData[userId] = {};
                for (const subject of subjects) {
                    attendanceData[userId][subject] = initializeSubjectData();
                }
            }
        }
        fs.writeFileSync('attendance.json', JSON.stringify(attendanceData));
        console.log('Initialized attendance data for all members.');

        await clearMessages(attendanceChannelId);
        await sendInstructions(attendanceChannelId);

        setInterval(checkAndMarkAttendance, 60 * 1000);
    } catch (error) {
        console.error('Error in ready event:', error);
    }
});

client.on('messageCreated', async (message) => {
    const senderId = message.createdById || message.authorId;
    const channelId = message.channelId;
    console.log('Raw message content:', message.content);
    const content = message.content.trim();
    const args = content.split(/\s+/);
    const command = args[0].toLowerCase();
    console.log('Command received:', command);
    console.log('Sender ID:', senderId);
    const mention = args[1] && extractUserId(args[1]);
    console.log('Mention:', mention);
    const targetId = mention || senderId;
    const today = new Date();
    const todayStr = today.toLocaleDateString('en-GB');

    if (lastProcessedDate !== todayStr) {
        for (const userId in attendanceData) {
            for (const subject in attendanceData[userId]) {
                attendanceData[userId][subject].absentToday = false;
            }
        }
        lastProcessedDate = todayStr;
        fs.writeFileSync('attendance.json', JSON.stringify(attendanceData));
    }

    if (!attendanceData[targetId]) {
        attendanceData[targetId] = {};
        for (const subject of subjects) {
            attendanceData[targetId][subject] = initializeSubjectData();
        }
    }

    const retroactiveAbsenceMatch = command.match(/^!abb(\d{8})$/);
    let events;
    let targetDate = today;
    let targetDateStr = todayStr;

    if (retroactiveAbsenceMatch) {
        const dateStr = retroactiveAbsenceMatch[1];
        const day = dateStr.slice(0, 2);
        const month = dateStr.slice(2, 4);
        const year = dateStr.slice(4, 8);
        const parsedDateStr = `${day}/${month}/${year}`;
        const parsedDate = new Date(`${year}-${month}-${day}`);

        if (isNaN(parsedDate.getTime())) {
            await client.rest.post(`/channels/${channelId}/messages`, { content: `Invalid date format! Please use DDMMYYYY (e.g., !abb25032025 for 25/03/2025).` });
            return;
        }

        targetDate = parsedDate;
        targetDateStr = parsedDate.toLocaleDateString('en-GB');
        events = await getCalendarEvents(targetDate);
    } else {
        events = await getCalendarEvents(today);
    }

    console.log('Events fetched:', events);
    const isHoliday = events.calendarEvents.some(e => e.name.toLowerCase().includes('holiday') || e.name.toLowerCase().includes('festival'));
    if (isHoliday && !['!startcount', '!stopcount', '!undo'].includes(command)) {
        await client.rest.post(`/channels/${channelId}/messages`, { content: `The specified date (${targetDateStr}) is a holiday! No attendance actions allowed.` });
        return;
    }

    if (command === '!startcount') {
        isCounting = true;
        await client.rest.post(`/channels/${channelId}/messages`, { content: 'Attendance tracking started!' });
    } else if (command === '!stopcount') {
        isCounting = false;
        attendanceData = {};
        fs.writeFileSync('attendance.json', JSON.stringify(attendanceData));
        await client.rest.post(`/channels/${channelId}/messages`, { content: 'Attendance tracking paused! All data has been reset.' });
        return;
    }

    if (command === '!test') {
        await client.rest.post(`/channels/${channelId}/messages`, { content: 'Bot is working!' });
    }

    if (command === '!help') {
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
- **Subjects**: math, phy, c, mech, plab, clab, kan, sub1 (update sub1 later).
`;
        await client.rest.post(`/channels/${channelId}/messages`, { content: helpMessage });
    }

    if (command === '!when') {
        if (!attendanceData[targetId] || Object.keys(attendanceData[targetId]).length === 0) {
            await client.rest.post(`/channels/${channelId}/messages`, { content: `${targetId === senderId ? 'You have' : `<@${targetId}> has`} no absence records yet!` });
            return;
        }

        let absenceList = `${targetId === senderId ? 'Your' : `<@${targetId}>’s`} Absence Dates:\n`;
        let hasAbsences = false;

        for (const subject of subjects) {
            if (attendanceData[targetId][subject] && attendanceData[targetId][subject].absentDates) {
                for (const entry of attendanceData[targetId][subject].absentDates) {
                    if (entry.fullAbsence) {
                        absenceList += `${entry.date} - Absent\n`;
                    } else {
                        absenceList += `${entry.date} - Absent for ${subject}\n`;
                    }
                    hasAbsences = true;
                }
            }
        }

        if (!hasAbsences) {
            absenceList += 'No absences recorded.\n';
        }

        await client.rest.post(`/channels/${channelId}/messages`, { content: absenceList });
    }

    if (!isCounting && !['!startcount', '!stopcount', '!att', '!test', '!help', '!when'].includes(command) && !command.startsWith('!att')) return;

    if (command === '!abb' || retroactiveAbsenceMatch) {
        const subjectCounts = {};
        for (const event of events.calendarEvents) {
            const subject = event.name.toLowerCase().replace(' class', '').trim();
            if (!subjectCounts[subject]) {
                subjectCounts[subject] = 0;
            }
            subjectCounts[subject] += 1;
        }

        for (const subject in subjectCounts) {
            if (!attendanceData[targetId][subject]) {
                attendanceData[targetId][subject] = initializeSubjectData();
            }
            attendanceData[targetId][subject].absentDates = attendanceData[targetId][subject].absentDates.filter(
                entry => entry.date !== targetDateStr
            );
            attendanceData[targetId][subject].processedClasses = attendanceData[targetId][subject].processedClasses.filter(
                entry => entry.date !== targetDateStr
            );
            const wasPreviouslyCounted = attendanceData[targetId][subject].absentDates.some(
                entry => entry.date === targetDateStr
            );
            if (wasPreviouslyCounted) {
                attendanceData[targetId][subject].total -= subjectCounts[subject];
            }
        }

        for (const subject in subjectCounts) {
            if (!attendanceData[targetId][subject]) {
                attendanceData[targetId][subject] = initializeSubjectData();
            }
            const isToday = targetDateStr === todayStr;
            if (!isToday || !attendanceData[targetId][subject].absentToday) {
                attendanceData[targetId][subject].total += subjectCounts[subject];
                attendanceData[targetId][subject].attended = 0;
                if (isToday) {
                    attendanceData[targetId][subject].absentToday = true;
                }
                attendanceData[targetId][subject].absentDates.push({ date: targetDateStr, fullAbsence: true });
            }
        }
        lastCommand = { type: 'abb', targetId, events, date: targetDateStr };
        await client.rest.post(`/channels/${channelId}/messages`, { content: `Noted! ${targetId === senderId ? 'Your' : `<@${targetId}>’s`} status for ${targetDateStr}:\n${getStatus(targetId)}` });
    } else if (command.startsWith('!abb') && subjects.includes(command.slice(4))) {
        const subject = command.slice(4);
        const subjectEvents = events.calendarEvents.filter(event => event.name.toLowerCase().replace(' class', '').trim() === subject);
        const numClasses = subjectEvents.length;
        if (!attendanceData[targetId][subject]) {
            attendanceData[targetId][subject] = initializeSubjectData();
        }
        if (!attendanceData[targetId][subject].absentToday) {
            attendanceData[targetId][subject].total += numClasses;
            attendanceData[targetId][subject].attended = 0;
            attendanceData[targetId][subject].absentToday = true;
            attendanceData[targetId][subject].absentDates.push({ date: todayStr, fullAbsence: false });
        }
        lastCommand = { type: 'abbSubject', targetId, subject, events };
        await client.rest.post(`/channels/${channelId}/messages`, { content: `Noted! ${targetId === senderId ? 'Your' : `<@${targetId}>’s`} status:\n${getStatus(targetId)}` });
    } else if (command === '!abbrest') {
        const now = today.getTime();
        const todayStr = today.toLocaleDateString('en-GB');
        const subjectCounts = {};
        const pastSubjectCounts = {};
        const futureSubjectCounts = {};

        // Count all classes, past classes, and future classes for today
        for (const event of events.calendarEvents) {
            const eventDateStr = new Date(event.startsAt).toLocaleDateString('en-GB');
            if (eventDateStr !== todayStr) continue; // Skip events not on today

            const subject = event.name.toLowerCase().replace(' class', '').trim();
            if (!subjects.includes(subject)) continue;

            if (!subjectCounts[subject]) {
                subjectCounts[subject] = 0;
                pastSubjectCounts[subject] = 0;
                futureSubjectCounts[subject] = 0;
            }
            subjectCounts[subject] += 1;

            const startTime = new Date(event.startsAt).getTime();
            if (startTime <= now) {
                pastSubjectCounts[subject] += 1;
            } else {
                futureSubjectCounts[subject] += 1;
            }
        }

        for (const subject in subjectCounts) {
            if (!attendanceData[targetId][subject]) {
                attendanceData[targetId][subject] = initializeSubjectData();
            }

            // Clear today's processed classes and absences
            attendanceData[targetId][subject].absentDates = attendanceData[targetId][subject].absentDates.filter(
                entry => entry.date !== todayStr
            );
            attendanceData[targetId][subject].processedClasses = attendanceData[targetId][subject].processedClasses.filter(
                entry => entry.date !== todayStr
            );

            const pastClasses = pastSubjectCounts[subject] || 0;
            const futureClasses = futureSubjectCounts[subject] || 0;
            const totalClasses = subjectCounts[subject];

            // Reset total and attended for today
            const wasPreviouslyCounted = attendanceData[targetId][subject].processedClasses.some(
                entry => entry.date === todayStr
            );
            if (wasPreviouslyCounted) {
                attendanceData[targetId][subject].total -= totalClasses;
                attendanceData[targetId][subject].attended = 0;
            }

            // Mark past classes as attended, future classes as absent
            attendanceData[targetId][subject].total += totalClasses;
            attendanceData[targetId][subject].attended += pastClasses;
            if (futureClasses > 0) {
                attendanceData[targetId][subject].absentToday = true;
                attendanceData[targetId][subject].absentDates.push({ date: todayStr, fullAbsence: false });
            }
        }

        lastCommand = { type: 'abbrest', targetId, events, date: todayStr };
        await client.rest.post(`/channels/${channelId}/messages`, { content: `Noted! ${targetId === senderId ? 'Your' : `<@${targetId}>’s`} status:\n${getStatus(targetId)}` });
    } else if (command === '!extra') {
        const subject = args[2]?.toLowerCase() || args[1]?.toLowerCase();
        if (!subjects.includes(subject)) {
            await client.rest.post(`/channels/${channelId}/messages`, { content: 'Invalid subject!' });
            return;
        }
        if (!attendanceData[targetId][subject]) {
            attendanceData[targetId][subject] = initializeSubjectData();
        }
        attendanceData[targetId][subject].total += 1;
        attendanceData[targetId][subject].attended += 1;
        lastCommand = { type: 'extra', targetId, subject };
        await client.rest.post(`/channels/${channelId}/messages`, { content: `Extra ${subject} class recorded for ${targetId === senderId ? 'you' : `<@${targetId}>`}.` });
    } else if (command.startsWith('!att') && subjects.includes(command.slice(4))) {
        const subject = command.slice(4);
        if (!attendanceData[targetId][subject]) {
            attendanceData[targetId][subject] = initializeSubjectData();
        }
        const { attended, total } = attendanceData[targetId][subject];
        const percentage = total > 0 ? Math.max(0, (attended / total) * 100) : 0;
        const response = `${targetId === senderId ? 'Your' : `<@${targetId}>’s`} **${subject}**: ${percentage.toFixed(2)}% (${attended}/${total})`;
        await client.rest.post(`/channels/${channelId}/messages`, { content: response });
    } else if (command === '!att') {
        console.log('Target ID:', targetId);
        console.log('Attendance data for target:', attendanceData[targetId]);
        if (Object.keys(attendanceData[targetId]).length === 0) {
            await client.rest.post(`/channels/${channelId}/messages`, { content: `${targetId === senderId ? 'You have' : `<@${targetId}> has`} no attendance data yet!` });
            return;
        }
        let response = `${targetId === senderId ? 'Your' : `<@${targetId}>’s`} Attendance:\n`;
        for (const subject of subjects) {
            if (attendanceData[targetId][subject]) {
                const { attended, total } = attendanceData[targetId][subject];
                const percentage = total > 0 ? Math.max(0, (attended / total) * 100) : 0;
                const status = percentage >= 75 ? '✅ Eligible' : '⚠️ Not Eligible';
                response += `**${subject}**: ${percentage.toFixed(2)}% (${attended}/${total}) ${status}\n`;
            }
        }
        await client.rest.post(`/channels/${channelId}/messages`, { content: response });
    } else if (command === '!undo' && lastCommand && lastCommand.targetId === targetId) {
        const undoDateStr = lastCommand.date || todayStr;
        if (lastCommand.type === 'abb') {
            const subjectCounts = {};
            for (const event of lastCommand.events.calendarEvents) {
                const subject = event.name.toLowerCase().replace(' class', '').trim();
                if (!subjectCounts[subject]) {
                    subjectCounts[subject] = 0;
                }
                subjectCounts[subject] += 1;
            }
            for (const subject in subjectCounts) {
                attendanceData[targetId][subject].total -= subjectCounts[subject];
                attendanceData[targetId][subject].attended = 0;
                if (undoDateStr === todayStr) {
                    delete attendanceData[targetId][subject].absentToday;
                }
                attendanceData[targetId][subject].absentDates = attendanceData[targetId][subject].absentDates.filter(
                    entry => entry.date !== undoDateStr
                );
                attendanceData[targetId][subject].processedClasses = attendanceData[targetId][subject].processedClasses.filter(
                    entry => entry.date !== undoDateStr
                );
            }
        } else if (lastCommand.type === 'abbSubject') {
            for (const event of lastCommand.events.calendarEvents) {
                const evtSubject = event.name.toLowerCase().replace(' class', '').trim();
                if (evtSubject === lastCommand.subject) {
                    attendanceData[targetId][evtSubject].attended += 1;
                    attendanceData[targetId][evtSubject].total -= 1;
                    attendanceData[targetId][evtSubject].absentDates = attendanceData[targetId][evtSubject].absentDates.filter(
                        entry => entry.date !== todayStr
                    );
                    attendanceData[targetId][evtSubject].processedClasses = attendanceData[targetId][evtSubject].processedClasses.filter(
                        entry => entry.date !== todayStr
                    );
                } else {
                    attendanceData[targetId][evtSubject].attended -= 1;
                    attendanceData[targetId][evtSubject].total -= 1;
                }
            }
        } else if (lastCommand.type === 'abbrest') {
            const subjectCounts = {};
            const futureSubjectCounts = {};
            const now = today.getTime();
            for (const event of lastCommand.events.calendarEvents) {
                const eventDateStr = new Date(event.startsAt).toLocaleDateString('en-GB');
                if (eventDateStr !== todayStr) continue;

                const subject = event.name.toLowerCase().replace(' class', '').trim();
                if (!subjectCounts[subject]) {
                    subjectCounts[subject] = 0;
                }
                subjectCounts[subject] += 1;

                const startTime = new Date(event.startsAt).getTime();
                if (startTime > now) {
                    if (!futureSubjectCounts[subject]) {
                        futureSubjectCounts[subject] = 0;
                    }
                    futureSubjectCounts[subject] += 1;
                }
            }
            for (const subject in subjectCounts) {
                const pastClasses = subjectCounts[subject] - (futureSubjectCounts[subject] || 0);
                attendanceData[targetId][subject].total -= subjectCounts[subject];
                attendanceData[targetId][subject].attended -= pastClasses;
                delete attendanceData[targetId][subject].absentToday;
                attendanceData[targetId][subject].absentDates = attendanceData[targetId][subject].absentDates.filter(
                    entry => entry.date !== undoDateStr
                );
                attendanceData[targetId][subject].processedClasses = attendanceData[targetId][subject].processedClasses.filter(
                    entry => entry.date !== undoDateStr
                );
            }
        } else if (lastCommand.type === 'extra') {
            attendanceData[targetId][lastCommand.subject].total -= 1;
            attendanceData[targetId][lastCommand.subject].attended -= 1;
        }
        lastCommand = null;
        await client.rest.post(`/channels/${channelId}/messages`, { content: 'Last command undone!' });
    }

    fs.writeFileSync('attendance.json', JSON.stringify(attendanceData));
});

client.login();