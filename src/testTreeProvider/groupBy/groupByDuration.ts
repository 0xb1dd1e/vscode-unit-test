import { GroupBy } from './groupBy'
import { TestCase, TestCaseStatus } from '../../testTreeModel/testCase';
import { TreeLabel } from '../../testTreeModel/treeLabel'
import { TestTreeType } from "../../testTreeModel/treeType"

export class GroupByDuration extends GroupBy {
    static TYPE: string = "GroupByDuration";

    constructor() {
        super(GroupByDuration.TYPE, "Duration", "Groups test by execution time: Fast, Medium, and Slow.");
    }

    /**
     * Return a array list of all slow tests
     */
    public getSlowTests(testCases: Array<TestCase>): Array<TestCase> {
        const tests = testCases.filter((test: TestCase) => {
            if (test.getDurationInMilliseconds() > 1000) {
                return true;
            }
            return false;
        });
        return tests;
    }

    /**
     * Return a array list of all slow tests
     */
    public getMediumTests(testCases: Array<TestCase>): Array<TestCase> {
        const tests = testCases.filter((test: TestCase) => {
            if (test.getDurationInMilliseconds() >= 100 && test.getDurationInMilliseconds() <= 1000) {
                return true;
            }
            return false;
        });
        return tests;
    }

    /**
     * Return a array list of all slow tests
     */
    public getFastTests(testCases: Array<TestCase>): Array<TestCase> {
        const tests = testCases.filter((test: TestCase) => {
            if (test.getDurationInMilliseconds() < 100) {
                return true;
            }
            return false;
        });
        return tests;
    }

    /**
     * Return a promise of Array<TestTreeType> that has all the test classified by a certain logic.
     * Group the test by duration (Not Run, Fast, Medium, Slow)
     * @param testCases The available test cases
     */
    public getCategories(testCases: Array<TestCase>): Promise<Array<TestTreeType>> {
        return new Promise<Array<TestTreeType>>((resolve, reject) => {
            const outcomeArray = new Array<TreeLabel>();


            const notRunTestsLabel: TreeLabel = new TreeLabel("Not Run Tests", TestCaseStatus.None, this.getNotRunTests(testCases));
            const fastTestsLabel: TreeLabel = new TreeLabel("Fast < 100ms", TestCaseStatus.None, this.getFastTests(testCases));
            const mediumTestsLabel: TreeLabel = new TreeLabel("Medium >= 100ms", TestCaseStatus.None, this.getMediumTests(testCases));
            const slowTests: TreeLabel = new TreeLabel("Slow > 1sec", TestCaseStatus.None, this.getSlowTests(testCases));

            // only add filters if there is children to display
            if (notRunTestsLabel.getChildrenLenght() > 0) {
                outcomeArray.push(notRunTestsLabel);
            }
            if (fastTestsLabel.getChildrenLenght() > 0) {
                outcomeArray.push(fastTestsLabel);
            }
            if (mediumTestsLabel.getChildrenLenght() > 0) {
                outcomeArray.push(mediumTestsLabel);
            }
            if (slowTests.getChildrenLenght() > 0) {
                outcomeArray.push(slowTests);
            }

            Promise.resolve(outcomeArray);

        });
    }
}