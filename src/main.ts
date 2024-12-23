import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as path from 'path'
import * as fs from 'fs'
import * as github from '@actions/github'
import * as os from 'os'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */

async function getGitDiffFiles(): Promise<string[]> {
  let stdout = ''

  const options: exec.ExecOptions = {
    listeners: {
      stdout: (data: Buffer) => {
        stdout += data.toString()
      }
    }
  }

  // Run the git diff command
  await exec.exec(
    'git',
    [
      'diff',
      '--name-only',
      '--diff-filter=ACMRU',
      '--relative',
      'origin/main',
      '--',
      '*.sql'
    ],
    options
  )

  // Process and return the list of files
  return stdout
    .trim()
    .split('\n')
    .filter(file => file.length > 0)
}

function resolveAndCheckPath(
  inputPath: string | undefined
): string | undefined {
  if (!inputPath) {
    return undefined // Return undefined if no input is provided
  }

  const resolvedPath = path.resolve(inputPath)

  // Return the resolved path only if it exists
  return fs.existsSync(resolvedPath) ? resolvedPath : undefined
}

async function setupUV(): Promise<void> {
  // Use UV to manage dependencies
  try {
    await exec.exec('python', ['-m', 'pip', 'install', '--user', 'pipx'])
    await exec.exec('pipx', ['install', 'uv'])
    await exec.exec('pipx', ['ensurepath'])
    console.log('Successfully installed uv.')
  } catch (error) {
    console.error('Failed to install uv:', error)
    throw error
  }
}

async function setupDependencies(
  pyprojectPath: string | undefined
): Promise<void> {
  // Use UV to manage dependencies

  try {
    await exec.exec('uv', ['venv'])
    await exec.exec('uv', ['pip', 'sync', `${pyprojectPath}`])
    console.log('Successfully installed dependencies.')
  } catch (error) {
    console.error('Failed to install dependencies:', error)
    throw error
  }
}

export async function run(): Promise<void> {
  try {
    console.log('Installing uv...')
    await setupUV()

    // check if there is a pyproject.toml we can use
    let pyprojectPath = core.getInput('pyproject-path')
    core.info(`Received pyproject.toml path: ${pyprojectPath}`)

    if (!pyprojectPath) {
      pyprojectPath = path.resolve(__dirname, 'pyproject.toml')
      core.info(
        `No custom path provided. Using default pyproject.toml at: ${pyprojectPath}`
      )
    }

    // Install the dependencies using uv
    await setupDependencies(pyprojectPath)

    // check what type of project this is (e.g. Snowflake with dbt)
    const dbtProjectDir = core.getInput('dbt-project-path') || undefined
    const dbtProfilesDir = core.getInput('dbt-profiles-path') || undefined
    const sqlfluffDialect = core.getInput('sqlfluff-dialect')
    const sqlfluffTemplater = core.getInput('sqlfluff-templater')
    const dbtExec = path.resolve('.venv/bin/dbt')
    const sqlfluffExec = path.resolve('.venv/bin/sqlfluff')

    if (dbtProjectDir) {
      core.info(`DBT project directory set to: ${dbtProjectDir}`)

      // change directory to dbt project directory

      process.chdir(path.resolve(dbtProjectDir))
      core.info(`Changed working directory to: ${dbtProjectDir}`)
    }

    if (dbtProfilesDir) {
      core.info(`DBT profiles directory set to: ${dbtProfilesDir}`)
      process.env.DBT_PROFILES_DIR = dbtProfilesDir
      process.env.DBT_TARGET = 'sqlfluff'
      core.info(`DBT target set to: sqlfluff`)
      await exec.exec(`${dbtExec}`, ['deps'])
    }

    // check for file changes
    const filePaths = await getGitDiffFiles()

    if (filePaths.length === 0) {
      console.log('No SQL files changed.')
      return
    }

    await exec.exec(`${sqlfluffExec}`, [
      'lint',
      '--dialect',
      `${sqlfluffDialect}`,
      '--templater',
      `${sqlfluffTemplater}`,
      ...filePaths
    ])
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
