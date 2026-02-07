param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

node "$PSScriptRoot\..\src\cli\clipscribe.js" @Args
