'use strict';
const vscode = require('vscode'),
	expect = require('expect.js'),
	path = require('path'),
	fs = require('fs'),
	testData = require('./testData'),
	os = require('os');

const slow = 10 * (1000000 / os.cpus()
	.slice(0, 4)
	.reduce((t, cpu) => t + cpu.speed, 0)) | 0;

const root = path.join(__dirname, 'data', '');

const lag = () => new Promise(resolve => setTimeout(resolve, slow / 4 | 0));

const setupConfigs = (beautify, editor) => {
	fs.writeFileSync(path.join(root, '.jsbeautifyrc'), beautify ? JSON.stringify(beautify) : '');
	fs.writeFileSync(path.join(root, '.editorconfig'), editor ? editor : '');
	return lag();
};
const listener = vscode.window.onDidChangeActiveTextEditor(editor => {
	if (!editor.document.test || !editor.document.test.eol) return;
	const doc = editor.document;
	const eol = doc.test.eol;
	const cmd = doc.test.cmd;
	const resolve = doc.test.resolve;
	const tea = doc.test.texteditorAction;
	return editor.edit(te => {
			te.setEndOfLine(eol);
			if (tea) return tea(te);
		})
		.then(() => {
			return vscode.commands.executeCommand(cmd)
				.then(() => {
					const txt = doc.getText();
					return vscode.commands.executeCommand('workbench.action.closeAllEditors')
						.then(() => resolve(txt));
				});
		});
});

after(() => listener.dispose());

const executeWithCommand = (cmd, texteditorAction, name, eol) => vscode.workspace.openTextDocument(name)
	.then(doc => new Promise(resolve => {
		vscode.window.showTextDocument(doc);
		doc.test = {
			cmd,
			eol,
			resolve,
			texteditorAction,
			t: process.hrtime()
		};
	}));

const getPartialBeautifiedText = (name, eol) => executeWithCommand('HookyQR.beautify', () => {
	return vscode.commands.executeCommand('cursorMove', {
			to: 'right',
			by: 'character',
			amount: 1,
			select: true
		})
		.then(() => {
			return new Promise(res => setTimeout(res, 1000));
		});
}, name, eol);

const getBeautifiedText = (name, eol) => executeWithCommand('HookyQR.beautifyFile', null, name, eol);
const getFormattedText = (name, eol) => executeWithCommand('editor.action.formatDocument', null, name, eol);

const getOnSaveText = (name, eol) => vscode.workspace.openTextDocument(name)
	.then(doc => vscode.window.showTextDocument(doc)
		.then(editor => editor.edit(te => {
			te.setEndOfLine(eol);
			te.insert(doc.positionAt(Infinity), ' ');
		})))
	.then(() => vscode.commands.executeCommand('workbench.action.files.save'))
	.then(lag)
	.then(() => vscode.commands.executeCommand('workbench.action.closeAllEditors'))
	.then(lag)
	.then(() => fs.readFileSync(name, "utf8"));

function beautifyEach(fmt) {
	testData.types.forEach(function(ext) {
		it(`For '${ext}' "beautifyFile" changes for ${fmt[0]}`, function() {
			return getBeautifiedText(path.join(root, 'test.' + ext), fmt[1])
				.then(txt => expect(txt)
					.to.be(testData.expected(fmt[0], ext)));
		});
	});
}

function formatEach(fmt) {
	testData.types.forEach(function(ext) {
		// inbuild format command doesn't allow beautify to run. Maybe in 1.6?
		if (ext === 'json') return;
		it(`For '${ext}' "format" changes for ${fmt[0]}`, function() {
			return getFormattedText(path.join(root, 'test.' + ext), fmt[1])
				.then(txt => expect(txt)
					.to.be(testData.expected(fmt[0], ext)));
		});
	});
}

function beautifyPartialEach(fmt) {
	testData.types.forEach(function(ext) {
		it(`For '${ext}' "beautify" changes for ${fmt[0]}`, function() {
			return getPartialBeautifiedText(path.join(root, 'test.' + ext), fmt[1])
				.then(txt => expect(txt)
					.to.be(testData.expected(fmt[0], ext)));
		});
	});
}

function doSaveEach(fmt) {
	testData.types.forEach(function(ext) {
		//if (ext === 'js') return;
		it(`For '${ext}' "beautify on save" changes`, function() {
			return getOnSaveText(path.join(root, 'test.' + ext), fmt[1])
				.then(txt => expect(txt)
					.to.be(testData.expected(fmt[0], ext)));
		});
	});
}

// delay test start to give vscode a chance to load (For Travis OSX)
describe("VS code beautify", function() {
	this.timeout(slow * 2);
	this.slow(slow);
	before(() => {
		testData.clean(root);
		vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
	});

	let eolstr = {
		"\n": ["lf", vscode.EndOfLine.LF],
		"\r\n": ["crlf", vscode.EndOfLine.CRLF]
	};
	Object.keys(eolstr)
		.forEach(eol => {
			let config = {
				jsbeautify: [{
					indent_size: 4,
					eol
					}, null],
				editorconfig: [null,
					`root = true\r\n[*]\r\nend_of_line = ${eolstr[eol][0]}\r\nindent_style = space\r\nindent_size = 4`],
				'vs code': [null, ""]
			};
			Object.keys(config)
				.forEach(cfg => {
					context(`with ${cfg} cr set to ${JSON.stringify(eol)}`, function() {
						before(() => setupConfigs(config[cfg][0], config[cfg][1]));
						beautifyEach(eolstr[eol]);
						// this combo doesn't work on AV.
						// There are some conversion errors that seem to happen in
						// the editor.
						if (process.platform === 'win32' && cfg === 'vs code' && eol === "\n") return;
						formatEach(eolstr[eol]);
					});
				});
		});
	let config = {
		jsbeautify: [{
			eol: "\n",
			indent_with_tabs: true
		}, ""],
		editorconfig: [null, `root = true\r\n[*]\r\nend_of_line = lf\r\nindent_style = tab\r\nindent_size = 2\r\n`]
	};
	Object.keys(config)
		.forEach(cfg => {
			context(`with ${cfg} indent set to 'tab'`, function() {
				before(() => setupConfigs(config[cfg][0], config[cfg][1]));
				beautifyEach(['tab', vscode.EndOfLine.LF]);
				formatEach(['tab', vscode.EndOfLine.LF]);
			});
		});
	// nested config
	context('with nested config', function() {
		before(() => setupConfigs({
			js: {
				indent_size: 5
			},
			css: {
				indent_size: 4
			},
			html: {
				indent_size: 3
			},
			eol: "\r\n",
			indent_with_tabs: false,
			indent_size: 2
		}));
		beautifyEach(['nested', vscode.EndOfLine.CRLF]);
		formatEach(['nested', vscode.EndOfLine.CRLF]);
	});

	context('Using `config` setting', function() {
		const config = vscode.workspace.getConfiguration();
		let revert = config.get("beautify.config");
		before(() => fs.renameSync(path.join(root, ".jsbeautifyrc"), path.join(root, "tmp.jsbeautifyrc")));

		context('with file name', function() {
			before(() => config.update("beautify.config", path.join(root, "jsbeautify_config.json"))
				.then(lag));
			beautifyEach(['tab', vscode.EndOfLine.LF]);
			after(() => config.update("beautify.config", revert));
		});

		context('with inline settings', function() {
			before(() => config.update("beautify.config", {
					"eol": "\n",
					"indent_with_tabs": true
				})
				.then(lag));
			beautifyEach(['tab', vscode.EndOfLine.LF]);
			after(() => config.update("beautify.config", revert));
		});
		after(() => fs.renameSync(path.join(root, "tmp.jsbeautifyrc"), path.join(root, ".jsbeautifyrc")));
	});

	context('partial', function() {
		before(() => setupConfigs({
			eol: "\r\n",
			indent_with_tabs: false,
			indent_size: 2
		}));
		beautifyPartialEach(['partial', vscode.EndOfLine.LF]);
	});
	context('on save', function() {
		this.timeout(slow * 4);
		this.slow(slow * 2);
		const config = vscode.workspace.getConfiguration();
		let revert;
		before(() => {
			revert = config.get("editor.formatOnSave");
			return config.update("editor.formatOnSave", true)
				.then(() => setupConfigs({
					js: {
						indent_size: 5
					},
					css: {
						indent_size: 4
					},
					html: {
						indent_size: 3
					},
					eol: "\r\n",
					indent_with_tabs: false,
					indent_size: 2
				}));
		});
		after(() => {
			config.update("editor.formatOnSave", revert);
			testData.clean(root);
		});
		doSaveEach(['nested', vscode.EndOfLine.CRLF]);
	});
});
