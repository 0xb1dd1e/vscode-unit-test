import * as vscode from "vscode";
import { TestCase, TestCaseStatus } from "../testLanguage/protocol"
import { TreeLabel } from "./treeLabel"
import { GroupByProvider } from "./groupByProvider"
import { isExtensionEnabled, isAutoInitializeEnabled } from "../utils/vsconfig"
import { getImageResource } from "../utils/image"
import { TestTreeLanguageClient } from "./testTreeLanguageClient"
import * as Collections from "typescript-collections";
import { TestTreeType } from "./treeType"

/**
 * Register the test tree explorer
 * @param context 
 */
export function RegisterVSTestTreeProvider(context: vscode.ExtensionContext) {
    let testTreeDataProvider: TestTreeDataProvider;
    testTreeDataProvider = new TestTreeDataProvider(context);
    vscode.window.registerTreeDataProvider("unit.test.explorer.vsTestTree", testTreeDataProvider);
}


/**
 * Additional data to help the tree data provider
 */
class TestAdditionalData {
    collapsibleState: vscode.TreeItemCollapsibleState;
}

enum TestTreeDataProviderStatus {
    None,
    Initializing,
    FindingTests,
    Ready
}

export class TestTreeDataProvider implements vscode.TreeDataProvider<TestTreeType> {
    public _onDidChangeTreeData: vscode.EventEmitter<TestTreeType | null> = new vscode.EventEmitter<TestTreeType | null>();
    readonly onDidChangeTreeData: vscode.Event<TestTreeType | null> = this._onDidChangeTreeData.event;

    /**
     * The test service to discover and run tests
     */
    private testLanguageClient: TestTreeLanguageClient;

    /**
     * Group by filter provider that categorizes the test cases
     */
    private groupByFilter: GroupByProvider = new GroupByProvider();

    /**
     * Additional test data related to handling the tree view
     */
    private testsAdditionalData: Collections.Dictionary<string, TestAdditionalData> = new Collections.Dictionary<string, TestAdditionalData>();

    /**
     * Current test tree status
     */
    private status: TestTreeDataProviderStatus = TestTreeDataProviderStatus.None;

    private rootDir = null;

    /**
     * Create the test result output channel
     */
    private testResultOutputChannel = vscode.window.createOutputChannel('Test Result');

    /**
     * 
     */
    constructor(private context: vscode.ExtensionContext) {
        //todo: bug here when there is more than one workspace folders
        this.rootDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
        this.testLanguageClient = new TestTreeLanguageClient(this.rootDir);
        this.testLanguageClient.initialize().then((version) => {
            this.registerCommands(context);

            this.registerTestServiceListeners();

            this.discoveryTests();
        });
    }

    /**
     * Get children method that must be implemented by test tree provider
     * @param item The test case to draw on the test tree
     */
    public getChildren(item?: TestTreeType): Thenable<TestTreeType[]> {
        switch (this.status) {
            case TestTreeDataProviderStatus.None:
                return this.createNotInitializedLabel();
            case TestTreeDataProviderStatus.Initializing:
                return this.createInitializingLabel();
        }

        // if the testcase exists then resolve it children
        if (item) {
            if (item instanceof TreeLabel) {
                return Promise.resolve(item.getChildren() ? item.getChildren() : []);
            }
            const filtered = this.testLanguageClient.testCaseCollection.testCasesDictionary.values().filter((testCase) => {
                return testCase.parendId === item.getId();
            });
            return Promise.resolve(filtered);
        }
        else {
            // if testcase = null means that we are in the root
            return this.groupByFilter.getSelected().getCategories(this.testLanguageClient.testCaseCollection.testCasesDictionary.values());
        }
    }

    /**
     * Render the test item
     * @param item The item that will be rendered 
     */
    public getTreeItem(item: TestTreeType): vscode.TreeItem {
        return <vscode.TreeItem>{
            label: item.title,
            collapsibleState: this.getItemCollapsibleState(item),
            command: {
                command: "unit.test.explorer.openTestResult",
                arguments: [item],
                title: item.title,
            },
            iconPath: this.getIcon(item)
        };
    }


    /**
     * The item to get the icon
     * @param item 
     */
    private getIcon(item: TestTreeType) {
        if (item instanceof TreeLabel) {
            return null;
        }

        if (item instanceof TestCase) {
            if (item.isRunning) {
                return getImageResource(`progress.svg`);
            }
            let appendStringIcon = "";
            if (item.sessionId != this.testLanguageClient.sessionId) {
                appendStringIcon = "_previousExec";
            }
            const outcome = item.status;
            switch (outcome) {
                case TestCaseStatus.Failed:
                    return getImageResource(`error${appendStringIcon}.svg`);
                case TestCaseStatus.None:
                    return getImageResource(`exclamation.svg`);
                case TestCaseStatus.NotFound:
                    return getImageResource("interrogation.svg");
                case TestCaseStatus.Passed:
                    return getImageResource(`checked${appendStringIcon}.svg`);
                case TestCaseStatus.Skipped:
                    return getImageResource(`skipped${appendStringIcon}.svg`);
            }
        }
        return getImageResource("interrogation.svg");
    }


    /** 
     * Called when discovery test is needed
     */
    private discoveryTests() {
        this.status = TestTreeDataProviderStatus.FindingTests;
        this.testLanguageClient.discoveryWorkspaceTests(this.rootDir).then((testCases) => {
            this.status = TestTreeDataProviderStatus.Ready;
            this._onDidChangeTreeData.fire();
        });
    }


    /**
     * Get tree item collapsible
     * @param item 
     */
    private getItemCollapsibleState(item: TestTreeType) {
        const treeItemAdditionalInfo: TestAdditionalData = this.testsAdditionalData.getValue(item.getId());
        if (treeItemAdditionalInfo) {
            return treeItemAdditionalInfo.collapsibleState;
        }

        if (item instanceof TreeLabel) {
            return vscode.TreeItemCollapsibleState.Expanded;
        }

        const hasChildren: boolean = this.testLanguageClient.testCaseCollection.testCasesDictionary.values().some((testCase) => {
            return testCase.parendId === item.getId();
        });

        return hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : null;
    }

    /**
     * Create a no test found label
     */
    private createNoTestFoundLabel() {
        const label: TreeLabel = new TreeLabel("No Test Found", TestCaseStatus.None, null);
        return Promise.resolve([label]);
    }

    /**
     * Create a not initialized label
     */
    private createNotInitializedLabel() {
        const label: TreeLabel = new TreeLabel("Not Initialized", TestCaseStatus.None, null);
        return Promise.resolve([label]);
    }

    /**
     * Create a not initialized label
     */
    private createInitializingLabel() {
        const label: TreeLabel = new TreeLabel("Initializing", TestCaseStatus.None, null);
        return Promise.resolve([label]);
    }

    /**
     * Run when the group by command is called
     */
    private onCommandGroupBy() {
        this.groupByFilter.show().then(() => {
            this.refrehTestExplorer(null);
        })
    }

    /** 
     * Method used to register test service listener like onDitTestCaseChanged 
     */
    private registerTestServiceListeners() {
        this.testLanguageClient.onDidTestCaseChanged((test: TestCase) => {
            this._onDidChangeTreeData.fire();
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
     */
    private onCommandRunAllTests() {
        /*const filtered = this.testLanguageClient.testCaseCollection.testCasesDictionary.values().filter((testCase) => {
            return testCase.parendId == null;
        })
        filtered.forEach((testCase) => {

        })
        const testCases = this.testLanguageClient.testCaseCollection.findAllChildrens(item.getId());
            testCases.push(item);
        this.testLanguageClient.runTests(filtered);*/
        //not implemented yet
    }

    /**
     * Run a specific test case item
     * @param item 
     */
    private runTest(item: TestTreeType) {
        if (item instanceof TreeLabel) {
            this.testLanguageClient.runTests(item.getChildren());
        }
        else {
            const testCases = this.testLanguageClient.testCaseCollection.findAllChildrens(item.getId());
            testCases.push(item);
            this.testLanguageClient.runTests(testCases);
        }
    }

  

    /**
     * Register test explorer commands
     * @param context 
     */
    private registerCommands(context: vscode.ExtensionContext) {

        //register the go to test location command
        const goToTestLocationCommand = vscode.commands.registerCommand("unit.test.explorer.open",
            (event) => this.onCommandGoToTestLocation(event));
        context.subscriptions.push(goToTestLocationCommand);

        //register the group by explorer command
        const groupByExplorerCommand = vscode.commands.registerCommand("unit.test.explorer.groupBy",
            () => this.onCommandGroupBy());
        context.subscriptions.push(groupByExplorerCommand);

        //register the refresh explorer command
        const refreshExplorerCommand = vscode.commands.registerCommand("unit.test.explorer.refresh",
            () => this.discoveryTests());
        context.subscriptions.push(refreshExplorerCommand);

        //register the run selected test command
        const runCommand = vscode.commands.registerCommand("unit.test.execution.runSelected",
            (item) => {
                if (item) {
                    this.runTest(item);
                }
            });
        context.subscriptions.push(runCommand);

        //register the show test case result command
        const showTestResultCommand = vscode.commands.registerCommand("unit.test.explorer.openTestResult",
            event => this.onCommandOpenTestCaseResult(event));
        context.subscriptions.push(showTestResultCommand);

        //register the run all test cases command
        const runAllTestCommand = vscode.commands.registerCommand("unit.test.execution.runAll",
            () => this.onCommandRunAllTests());
        context.subscriptions.push(runAllTestCommand);

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

    private refrehTestExplorer(test: TestCase) {
        this._onDidChangeTreeData.fire(test);
    }
}