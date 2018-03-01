import * as vscode from "vscode";
import { TestCase, TestCaseStatus, InitializeResult } from "./testLanguage/protocol"
import { TestTreeType } from "./testTreeProvider/treeType"
import { TestClient } from "./testClient"
import { TreeLabel } from "./testTreeProvider/treeLabel"
import { isExtensionEnabled, isAutoInitializeEnabled, getCurrentTestProviderName, getTestProviderSettings, readSettings } from "./utils/vsconfig"



export enum TestLanguageStatus {
    None,
    Initializing,
    FindingTests,
    Ready
}


export class TestProvider {
    public status: TestLanguageStatus = TestLanguageStatus.None
    /**
     * Create the test result output channel
     */
    private testResultOutputChannel = vscode.window.createOutputChannel('Test Result');

    private directory: string;
    public client: TestClient;

    constructor(private context: vscode.ExtensionContext) {
        //todo: bug here when there is more than one workspace folders
        //super
        //this.rootDir = vscode.workspace.workspaceFolders[0].uri.fsPath;


        this.registerServerCommands(context);

        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("unit.test")) {
                //restart server due to configuration changes
                this.onCommandRestartServer();
            }
        })

    }

    public initialize() {
        return new Promise((resolve, reject) => {
            this.directory = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.client = new TestClient(this.directory, readSettings(vscode.workspace.workspaceFolders[0].uri));

            this.client.initialize().then((result: InitializeResult) => {
                console.log("initalizeResult: " + JSON.stringify(result));
            
                resolve(result)
            });
        });
    }


    /**
     * Open the test case location
     * @param item 
     */
    private onCommandGoToTestLocation(item: TestTreeType) {
        if (item instanceof TestCase) {

            const uri: string = item.path;
            vscode.workspace.openTextDocument(uri).then(result => {
                vscode.window.showTextDocument(result);
                const editor = vscode.window.activeTextEditor;

                const range = editor.document.lineAt(item.line).range;
                editor.selection = new vscode.Selection(range.start, range.start);
                editor.revealRange(range);
            });
        }
    }

    /**
     * Command for run all test cases
     * @param If debugging is enabled
     */
    private onCommandRunAllTests(debug: boolean = false) {
        const filtered = this.client.testCaseCollection.testCasesDictionary.values().filter((testCase) => {
            return testCase.parentId == null;
        })

        this.client.runTests(filtered, debug);
    }

    /** 
     * Called when discovery test is needed
     */
    public discoveryTests() {
        this.status = TestLanguageStatus.FindingTests;
        this.client.discoveryWorkspaceTests(this.directory).then((testCases) => {
            this.status = TestLanguageStatus.Ready;
            //this._onDidChangeTreeData.fire();
        });
    }

    /**
     * Run a specific test case item
     * @param item 
     */
    private runTest(item: TestTreeType, debug: boolean = false) {
        if (item instanceof TreeLabel) {
            this.client.runTests(item.children, debug);
        }
        else {
            const testCases = this.client.testCaseCollection.findAllChildrens(item.id);
            testCases.push(item);
            this.client.runTests(testCases, debug);
        }
    }

    private registerBasicCommands(context: vscode.ExtensionContext) {
        //register the refresh explorer command
        const refreshExplorerCommand = vscode.commands.registerCommand("unit.test.explorer.refresh",
            () => this.discoveryTests());
        context.subscriptions.push(refreshExplorerCommand);

        //register the refresh explorer command
        const restartExplorerCommand = vscode.commands.registerCommand("unit.test.explorer.restart",
            () => this.onCommandRestartServer());
        context.subscriptions.push(restartExplorerCommand);
    }

    /**
     * Register test explorer commands
     * @param context 
     */
    private registerServerCommands(context: vscode.ExtensionContext) {

        //register the go to test location command
        const goToTestLocationCommand = vscode.commands.registerCommand("unit.test.explorer.open",
            (event) => this.onCommandGoToTestLocation(event));
        context.subscriptions.push(goToTestLocationCommand);

        //register the run selected test command
        const runTestCommand = vscode.commands.registerCommand("unit.test.execution.runSelected",
            (item) => { item ? this.runTest(item) : null });
        context.subscriptions.push(runTestCommand);

        //register the run selected test command
        const debugTestCommand = vscode.commands.registerCommand("unit.test.execution.debugSelected",
            (item) => { item ? this.runTest(item, true) : null });
        context.subscriptions.push(debugTestCommand);

        //register the show test case result command
        const showTestResultCommand = vscode.commands.registerCommand("unit.test.explorer.openTestResult",
            event => this.onCommandOpenTestCaseResult(event));
        context.subscriptions.push(showTestResultCommand);

        //register the run all test cases command
        const runAllTestCommand = vscode.commands.registerCommand("unit.test.execution.runAll",
            () => this.onCommandRunAllTests(false));
        context.subscriptions.push(runAllTestCommand);

        //register the debug all test cases command
        const debugAllTestCommand = vscode.commands.registerCommand("unit.test.execution.debugAll",
            () => this.onCommandRunAllTests(true));
        context.subscriptions.push(debugAllTestCommand);

        //register the stop test running command
        const stopTestCommand = vscode.commands.registerCommand("unit.test.execution.stop",
            () => this.onCommandStopTests());
        context.subscriptions.push(stopTestCommand);

    }

    private onCommandStopTests() {
        this.client.stopRunningTests();
    }

    private onCommandRestartServer() {
        this.client.stopServer();
    }

    /**
     * Open the output panel test case result and show the test case result
     * @param item 
     */
    private onCommandOpenTestCaseResult(item: TestTreeType) {
        if (item instanceof TestCase) {
            this.testResultOutputChannel.clear();
            this.testResultOutputChannel.show(true);
            this.testResultOutputChannel.appendLine(item.title);
            this.testResultOutputChannel.appendLine(`Source: ${item.path}:${item.line}:${item.column}`);

            if (item.status != TestCaseStatus.None) {
                this.testResultOutputChannel.appendLine(`Duration: ${item.duration}`);
                this.testResultOutputChannel.appendLine(`Start Time: ${item.startTime}`);
                this.testResultOutputChannel.appendLine(`End Time: ${item.endTime}`);

                if (item.status === TestCaseStatus.Failed) {
                    this.testResultOutputChannel.appendLine(`Error: ${item.errorMessage}`);
                    this.testResultOutputChannel.appendLine(`Stack Trace: ${item.errorStackTrace}`);
                }
            }
        }
    }
}