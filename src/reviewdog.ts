import * as exec from '@actions/exec'
import * as fs from 'fs'
import * as core from '@actions/core'

export type Violation = {
  description: string
  start_line_no: number
  start_line_pos: number
  end_line_no: number
  end_line_pos: number
}

export type LintResult = {
  filepath: string
  violations: Violation[]
}

export async function setupReviewDog(): Promise<void> {
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

export async function runReviewdog(rdjsonlFile: string): Promise<void> {
  const rdFileContent = fs.readFileSync(rdjsonlFile)
  const reviewdogName = core.getInput('review-dog-name')
  const reviewdogFilterMode = core.getInput('review-dog-filter-mode')
  const reviewdogFailOnError =
    core.getInput('review-dog-fail-on-error').toLowerCase() === 'true'

  await exec.exec(
    'reviewdog',
    [
      `-n=${reviewdogName}`,
      '-f=rdjsonl',
      `-filter-mode=${reviewdogFilterMode}`,
      '-reporter=github-pr-review',
      `-fail-on-error=${reviewdogFailOnError}`
    ],
    {
      input: rdFileContent
    }
  )
}

export function processLintOutput(
  lintOutput: LintResult[],
  rdLintResultsFile: string
): void {
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
