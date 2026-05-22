# Grok Editor

A powerful text editor for Mac, built with Electron, designed to integrate seamlessly with Grok CLI.

## Features

- **Syntax Highlighting**: Supports all major programming languages using Monaco Editor.

- **File Operations**: Open and save files with native dialogs.

- **Copy/Paste Raw Code**: Easily copy and paste code from documents; the editor handles formatting.

- **Batch Search**: Recursively search for patterns across all files in a directory.

- **Data Sorting**: Sort lines in a file alphabetically.

- **Project Sharing**: Share your code with console.x.ai for collaboration, batch processing, search, and data management.

## Installation

1. Navigate to the editor directory:

   cd /Users/tref/Desktop/vwall/editor

2. Install dependencies:

   npm install

## Running the Editor

npm start

This launches the Electron app.

## Integration with Grok CLI

From Grok CLI, you can execute:

bash cd /Users/tref/Desktop/vwall/editor && npm start

to launch the editor directly.

The editor allows you to edit files that Grok CLI can access, enabling seamless workflow.

## Sharing with console.x.ai

Use the "Share with console.x.ai" button to upload your current file. (Note: This is a placeholder; actual API endpoint may vary.)