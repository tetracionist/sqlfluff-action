"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
function resolveAndCheckPath(inputPath) {
    if (!inputPath) {
        return undefined; // Return undefined if no input is provided
    }
    const resolvedPath = path.resolve(inputPath);
    // Return the resolved path only if it exists
    return fs.existsSync(resolvedPath) ? resolvedPath : undefined;
}
async function setupUV() {
    // Use UV to manage dependencies 
    try {
        await exec.exec("python", ["-m", "pip", "install", "uv"]);
        console.log("Successfully installed uv.");
    }
    catch (error) {
        console.error("Failed to install uv:", error);
        throw error;
    }
}
async function setupDependencies(pyprojectPath) {
    // Use UV to manage dependencies 
    try {
        await exec.exec("python", ["-m", "uv", "pip", "install", "-r", `${pyprojectPath}`]);
        console.log("Successfully installed dependencies.");
    }
    catch (error) {
        console.error("Failed to install dependencies:", error);
        throw error;
    }
}
async function run() {
    try {
        console.log("Installing uv...");
        await setupUV();
        // check if there is a pyproject.toml we can use
        let pyprojectPath = core.getInput("pyproject-path");
        core.info(`Received pyproject.toml path: ${pyprojectPath}`);
        if (!pyprojectPath) {
            pyprojectPath = path.resolve(__dirname, "pyproject.toml");
            core.info(`No custom path provided. Using default pyproject.toml at: ${pyprojectPath}`);
        }
        // Install the dependencies using uv
        await setupDependencies(pyprojectPath);
        // check what type of project this is (e.g. Snowflake with dbt)
        const dbtProjectDir = core.getInput("dbt-project-path") || undefined;
        const dbtProfilesDir = core.getInput("dbt-profiles-path") || undefined;
        const sqlfluffDialect = core.getInput("sqlfluff-dialect");
        const sqlfluffTemplater = core.getInput("sqlfluff-templater");
        if (dbtProjectDir) {
            core.info(`DBT project directory set to: ${dbtProjectDir}`);
            // change directory to dbt project directory
            process.chdir(path.resolve(dbtProjectDir));
            core.info(`Changed working directory to: ${dbtProjectDir}`);
        }
        if (dbtProfilesDir) {
            core.info(`DBT profiles directory set to:: ${dbtProfilesDir}`);
        }
        await exec.exec("python", ["-m", "sqlfluff", "lint", "--dialect", `${sqlfluffDialect}`, "--templater", `${sqlfluffTemplater}`, "."]);
    }
    catch (error) {
        // Fail the workflow run if an error occurs
        if (error instanceof Error)
            core.setFailed(error.message);
    }
}
//# sourceMappingURL=main.js.map