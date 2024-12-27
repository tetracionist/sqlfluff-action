import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as path from 'path'
import * as fs from 'fs'
import {
  setupReviewDog,
  runReviewdog,
  LintResult,
  processLintOutput
} from './reviewdog'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */

const rdLintResultsFile = path.resolve('./lint-results.rdjsonl')

async function getGitDiffFiles(): Promise<string[]> {
  const baseRef = process.env.GITHUB_BASE_REF || 'main'

  console.log('Fetching main branch...')
  await exec.exec('git', ['fetch', 'origin', `${baseRef}`])

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
      `origin/${baseRef}`,
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

async function setupUV(): Promise<void> {
  // Use UV to manage dependencies
  try {
    await exec.exec('python', ['-m', 'pip', 'install', '--user', 'pipx'])
    await exec.exec('pipx', ['install', 'uv'])
    console.log('Successfully installed uv.')
  } catch (error) {
    console.error('Failed to install uv:', error)
    throw error
  }
}

async function setupDependencies(
  dependenciesPath: string | undefined
): Promise<void> {
  // Use UV to manage dependencies

  try {
    await exec.exec('uv', ['venv'])
    await exec.exec('uv', ['pip', 'install', '-r', `${dependenciesPath}`])
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

    // check if there is a pyproject.toml or requirements.txt we can use
    let dependenciesPath = core.getInput('dependencies-path')
    core.info(`Received dependencies path: ${dependenciesPath}`)

    if (!dependenciesPath) {
      dependenciesPath = path.resolve(__dirname, 'pyproject.toml')
      core.info(
        `No custom dependencies path provided. Using default pyproject.toml at: ${dependenciesPath}`
      )
    }

    // Install the dependencies using uv
    await setupDependencies(dependenciesPath)

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
      core.info('No SQL files changed.')
      return
    }
    try {
      await exec.exec(`${sqlfluffExec}`, [
        'lint',
        '--dialect',
        `${sqlfluffDialect}`,
        '--templater',
        `${sqlfluffTemplater}`,
        ...filePaths,
        '--format',
        'json',
        '--write-output',
        'lint-results.json'
      ])
    } catch (error) {
      console.error(error)
    }

    if (fs.existsSync('lint-results.json')) {
      const content = fs.readFileSync('lint-results.json', 'utf-8')
      const lintResults: LintResult[] = JSON.parse(content) as LintResult[]
      console.log('Parsed Lint Results:', lintResults)
      processLintOutput(lintResults, rdLintResultsFile)
    }

    // process as rdjsonl
    core.info('setup review dog')
    await setupReviewDog()

    core.info('running reviewdog')

    await runReviewdog(rdLintResultsFile)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
