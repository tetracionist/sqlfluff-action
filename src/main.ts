import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as path from 'path'
import * as fs from 'fs'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */

const rdLintResultsFile = path.resolve('./lint-results.rdjsonl')

type Violation = {
  description: string
  start_line_no: number
  start_line_pos: number
  end_line_no: number
  end_line_pos: number
}

type LintResult = {
  filepath: string
  violations: Violation[]
}

type RdjsonlLine = {
  message: string
  location: {
    path: string
    range: {
      start: {
        line: number
        column: number
      }
      end: {
        line: number
        column: number
      }
    }
  }
  severity: string
}

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
      `origin/${process.env.GITHUB_BASE_REF}`,
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
    console.log('Successfully installed uv.')
  } catch (error) {
    console.error('Failed to install uv:', error)
    throw error
  }
}

async function setupReviewDog(): Promise<void> {
  try {
    console.log('Installing Reviewdog...')
    await exec.exec('bash', [
      '-c',
      'curl -sfL https://raw.githubusercontent.com/reviewdog/reviewdog/master/install.sh | sh -s -- -b /usr/local/bin'
    ])
    console.log('Reviewdog installation completed.')
  } catch (error) {
    console.error('Failed to install Reviewdog:', error)
    throw error
  }
}

async function setupDependencies(
  pyprojectPath: string | undefined
): Promise<void> {
  // Use UV to manage dependencies

  try {
    await exec.exec('uv', ['venv'])
    await exec.exec('uv', ['pip', 'install', '-r', `${pyprojectPath}`])
    console.log('Successfully installed dependencies.')
  } catch (error) {
    console.error('Failed to install dependencies:', error)
    throw error
  }
}

async function processLintOutput(lintOutput: LintResult[]) {
  const rdjsonlines = lintOutput.flatMap(result =>
    result.violations.map(violation => ({
      message: violation.description,
      location: {
        path: `${result.filepath}`,
        range: {
          start: {
            line: violation.start_line_no,
            column: violation.start_line_pos
          },
          end: {
            line: violation.end_line_no,
            column: violation.end_line_pos
          }
        }
      },
      severity: 'ERROR'
    }))
  )

  const rdjsonlContent = rdjsonlines
    .map(line => JSON.stringify(line))
    .join('\n')
  fs.writeFileSync(rdLintResultsFile, rdjsonlContent, 'utf-8')
}

async function runReviewdog(rdjsonlFile: string): Promise<void> {
  const rdFileContent = fs.readFileSync(rdjsonlFile)

  await exec.exec(
    'reviewdog',
    [
      '-f=rdjsonl',
      '-filter-mode=file',
      '-reporter=github-pr-review',
      '-fail-on-error=true'
    ],
    {
      input: rdFileContent
    }
  )
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
    const workspaceDir = path.resolve('.')
    let lintResults: LintResult[] = []

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
    } catch (error) {}

    if (fs.existsSync('lint-results.json')) {
      const content = fs.readFileSync('lint-results.json', 'utf-8')
      let lintResults = JSON.parse(content)
      console.log('Parsed Lint Results:', lintResults)

      await processLintOutput(lintResults)
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
