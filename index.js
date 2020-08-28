const Discord = require("discord.js");
const fs = require("fs");
const path = require("path");
const client = new Discord.Client();
const basicCommands = new Map();
const hookCommands = new Map();

const { prefix, token } = require("./config.json");

var webhooks = {};
var _save = {};

function log(msg) {
	console.log(new Date().toUTCString() + " - " + msg);
}


function save() {
	fs.writeFile(path.join(__dirname, "webhooks.json"), JSON.stringify(_save), function (err) {
		if (err) throw err;
		log("Saved webhooks.");
	});
}


function reject(channel, msg) {
	channel.send(new Discord.MessageEmbed({
		color: "RED",
		title: "❌ " + msg
	}));
}

client.on("message", msg => {
	const author = msg.author;
	const content = msg.content;
	const member = msg.member;

	if (author.bot) return;
	if (!content.startsWith(prefix)) return;

	const args = content.slice(prefix.length).trim().split(" ");
	const command = args.shift().toLocaleLowerCase();

	if (basicCommands.has(command)) {
		basicCommands.get(command)(msg, args);
	} else if (hookCommands.has(command)) {
		if (!member.hasPermission("MANAGE_WEBHOOKS")) {
			reject(msg.channel, "You need the `Manage Webhooks` permission to use this command");
			return;
		}
		hookCommands.get(command)(msg, args);
	}

});

client.on("ready", async () => {
	log("Bot connected as " + client.user.tag);
	log("Loading webhooks frome save file...");
	client.user.setPresence({
		activity: {
			name: "&help",
			type: "LISTENING"
		},
	});
	try {
		_save = require("./webhooks.json");
	} catch {
		_save = {};
		save();
	}
	for (const g in _save) {
		var guild;
		try {
		guild = await client.guilds.fetch(g);
		} catch (err) {
			log("Guild " + g + " is unaivalable. Deleted.");
			delete _save[g];
			break;
		}
		if (!guild || !guild.available) {
			delete _save[g];
			break;
		}
		webhooks[g] = {};
		for (const w in _save[g]) {
			const hooks = await guild.fetchWebhooks();
			const h = hooks.get(_save[g][w].id);
			if (!h) {
				delete _save[g][w];
				break;
			}
			log("Loaded webhook " + w + " from guild " + guild.name + " (" + guild.id + ")");
			webhooks[g][w] = h;
		}
	}
	save();
	log("Bot ready");
});

async function createWebhook(msg, args) {
	const g = msg.guild.id;
	if (!webhooks[g]) {
		webhooks[g] = {};
		_save[g] = {};
	}
	var channel;
	if (/<?#?(\d{18})>?/.test(args[0])) {
		channel = msg.guild.channels.resolve(/<?#?(\d{18})>?/.exec(args.shift())[1]);
	}
	if (!channel) {
		reject(msg.channel, "Can't find channel");
		return;
	}
	if (channel.type !== "text") {
		reject(msg.channel, "Can't create a webhook in a non-text channel.");
		return;
	}
	const id = args[0] && args.shift().toLowerCase();
	if (!id) {
		reject(msg.channel, "Please specify an id for the webhook");
		return;
	}
	if (Object.keys(webhooks[g]).includes(id)) {
		reject(msg.channel, "This id is already used in this guild.");
		return;
	}
	var avatar;
	if (msg.attachments.first()) {
		const a = msg.attachments.first();
		if (a.url.endsWith(".png") || a.url.endsWith(".jpg") || a.url.endsWith(".webp") || a.url.endsWith(".gif")) {
			avatar = a.url;
		}
	}
	const name = args.join(" ").trim();
	if (!name) {
		reject(msg.channel, "Please give a name to your webhook");
		return;
	}
	var hook;
	try {
		hook = await channel.createWebhook(name, {
			avatar: avatar,
			reason: msg.author.tag
		});
	} catch (err) {
		reject(msg.channel, "An error occured\n`" + err.message + "`");
		return;
	}
	webhooks[g][id] = hook;
	_save[g][id] = { id: hook.id };
	msg.channel.send(new Discord.MessageEmbed({
		author: {
			iconURL: hook.avatarURL(),
			name: name
		},
		color: "GREEN",
		description: "Succesfully created and bound webhook to " + channel.toString(),
		footer: {
			text: "ID: " + id
		},
		timestamp: Date.now()
	}));
	log("Webhook created in " + msg.guild.name + " (" + msg.guild.id + ") : " + id);
	save();
}
hookCommands.set("create", createWebhook);

async function say(msg, args) {
	const g = msg.guild.id;
	const id = args[0] && args.shift().toLowerCase();
	if (!Object.keys(webhooks[g]).includes(id)) {
		reject(msg.channel, "Incorrect ID");
		return;
	}
	var message = "";
	message += args.join(" ");
	try {
		await webhooks[g][id].send(message);
		if (webhooks[g][id].channelID === msg.channel.id && msg.deletable) {
			msg.delete();
		}
	} catch (err) {
		if (err.message === "Unknown Webhook") {
			reject(msg.channel, "This webhook has been deleted. Please recreate it.");
			delete webhooks[g][id];
			delete _save[g][id];
			save();
			return;
		}
		reject(msg.channel, "An error occured\n`" + err.message + "`");
	}
}
hookCommands.set("say", say);

async function list(msg, args) {
	const g = msg.guild.id;
	if (!webhooks[g]) {
		webhooks[g] = {};
		_save[g] = {};
		save();
	}
	var embed = new Discord.MessageEmbed({
		author: {
			iconURL: msg.guild.iconURL({ dynamic: true }),
			name: msg.guild.name
		},
		title: "HookER webhooks for " + msg.guild.name,
		description: "HookER manages `" + Object.keys(webhooks[g]).length + "` webhooks in this server.",
		color: "#FFCBA4",
		footer: {
			text: "Requested by " + msg.author.tag,
			iconURL: msg.author.avatarURL()
		}
	});
	for (const i in webhooks[g]) {
		const h = webhooks[g][i];
		embed.description += "\n\n `" + i + "` : **" + h.name + "** in <#" + h.channelID + ">";
	}
	msg.channel.send(embed);
}
hookCommands.set("list", list);

async function rename(msg, args) {
	const g = msg.guild.id;
	const id = args[0] && args.shift().toLowerCase();
	if (!id || !webhooks[g][id]) {
		reject(msg.channel, "Incorrect ID");
		return;
	}
	const h = webhooks[g][id];
	const name = args.join(" ").trim();
	if (!name) {
		reject(msg.channel, "Incorect name");
		return;
	}
	try {
		await h.edit({
			name: name
		}, msg.author.tag);
	} catch (err) {
		if (err.message === "Unknown Webhook") {
			reject(msg.channel, "This webhook has been deleted. Please recreate it.");
			delete webhooks[g][id];
			delete _save[g][id];
			save();
			return;
		}
		reject(msg.channel, "An error occured\n`" + err.message + "`");
		return;
	}
	msg.channel.send(new Discord.MessageEmbed({
		color: "GREEN",
		description: "Succesfully renamed webhook `" + id + "` to **" + name + "**",
		timestamp: Date.now()
	}));
}
hookCommands.set("rename", rename);

async function changeChannel(msg, args) {
	const g = msg.guild.id;
	const id = args[0] && args.shift().toLowerCase();
	if (!id || !webhooks[g][id]) {
		reject(msg.channel, "Incorrect ID");
		return;
	}
	const h = webhooks[g][id];
	var channel;
	if (/<?#?(\d{18})>?/.test(args[0])) {
		channel = msg.guild.channels.resolve(/<?#?(\d{18})>?/.exec(args.shift())[1]);
	}
	if (!channel) {
		reject(msg.channel, "Can't find channel");
		return;
	}
	try {
		await h.edit({
			channel: channel
		}, msg.author.tag);
	} catch (err) {
		if (err.message === "Unknown Webhook") {
			reject(msg.channel, "This webhook has been deleted. Please recreate it.");
			delete webhooks[g][id];
			delete _save[g][id];
			save();
			return;
		}
		reject(msg.channel, "An error occured\n`" + err.message + "`");
	}
	msg.channel.send(new Discord.MessageEmbed({
		color: "GREEN",
		description: "Succesfully bound webhook `" + id + "` to " + channel.toString(),
		timestamp: Date.now()
	}));
}
hookCommands.set("channel", changeChannel);

async function avatar(msg, args) {
	const g = msg.guild.id;
	const id = args[0] && args.shift().toLowerCase();
	if (!id || !webhooks[g][id]) {
		reject(msg.channel, "Incorect ID");
		return;
	}
	var av;
	if (msg.attachments.first()) {
		const a = msg.attachments.first();
		if (a.url.endsWith(".png") || a.url.endsWith(".jpg") || a.url.endsWith(".webp") || a.url.endsWith(".gif")) {
			av = a.url;
		} else {
			reject(msg.channel, "Please provide a correct image. Accepted formats: `png`, `jpg`, `webp`, `gif`");
			return;
		}
	} else {
		reject(msg.channel, "Please attach an image");
		return;
	}
	const h = webhooks[g][id];
	try {
		await h.edit({
			avatar: av
		}, msg.author.tag);
	} catch (err) {
		if (err.message === "Unknown Webhook") {
			reject(msg.channel, "This webhook has been deleted. Please recreate it.");
			delete webhooks[g][id];
			delete _save[g][id];
			save();
			return;
		}
		reject(msg.channel, "An error occured\n`" + err.message + "`");
		return;
	}
	msg.channel.send(new Discord.MessageEmbed({
		author: {
			iconURL: av
		},
		color: "GREEN",
		description: "Succesfully set new avatar for webhook `" + id + "`",
		timestamp: Date.now()
	}));
}
hookCommands.set("avatar", avatar);

async function deleteHook(msg, args) {
	const g = msg.guild.id;
	const id = args[0] && args.shift().toLowerCase();
	if (!id || !webhooks[g][id]) {
		reject(msg.channel, "Incorect ID");
		return;
	}
	webhooks[g][id].delete(msg.author.tag);
	delete webhooks[g][id];
	delete _save[g][id];
	save();
	msg.channel.send(new Discord.MessageEmbed({
		color: "GREEN",
		description: "Succesfully deleeted webhook `" + id + "`",
		timestamp: Date.now()
	}));
	log("Webhook deleted in " + msg.guild.name + " (" + msg.guild.id + ") : " + id);
}
hookCommands.set("delete", deleteHook);

async function help(msg, args) {
	const embed = new Discord.MessageEmbed({
		author: {
			name: "HookER",
			iconURL: client.user.avatarURL()
		},
		title: "HookER commands help",
		description: "HookER's prefix : **`" + prefix + "`**"
			+ "\n\n`create <channel> <ID> <name> [avatar]` - Creates a webhook in the specified channel. You can attach an image to set the webhook's avatar."
			+ "\n\n`avatar <ID> <avatar>` - Changes a webhook's avatar. `<avatar>` is an attached image."
			+ "\n\n`channel <ID> <channel>` - Moves a webhook to another channel."
			+ "\n\n`delete <ID>` - Deletes a webhook"
			+ "\n\n`rename <ID> <name>` - Renames a webhook (changes display name, not ID)"
			+ "\n\n`list` - Lists the HookER webhooks of the server (webhooks that are not managed by HookER won't be listed)"
			+ "\n\n`say <ID> <message>` - Makes the webhook say something",
		color: "#FFCBA4",
		footer: {
			text: "Requested by " + msg.author.tag,
			iconURL: msg.author.avatarURL()
		}
	});
	msg.channel.send(embed);
}
basicCommands.set("help", help);

client.login(token);