# Contributing to CFlairCounter

First off, thank you for considering contributing to CFlairCounter! It's people like you that make CFlairCounter such a great tool.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Coding Standards](#coding-standards)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)

## Code of Conduct

This project and everyone participating in it is governed by our commitment to providing a welcoming and inspiring community for all.

### Our Standards

- Using welcoming and inclusive language
- Being respectful of differing viewpoints and experiences
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the issue list as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps which reproduce the problem**
- **Provide specific examples to demonstrate the steps**
- **Describe the behavior you observed after following the steps**
- **Explain which behavior you expected to see instead and why**
- **Include screenshots if possible**

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. Create an issue and provide the following information:

- **Use a clear and descriptive title**
- **Provide a step-by-step description of the suggested enhancement**
- **Provide specific examples to demonstrate the steps**
- **Describe the current behavior** and **explain the behavior you expected to see instead**
- **Explain why this enhancement would be useful**

### Pull Requests

- Fill in the required template
- Follow the [coding standards](#coding-standards)
- Include screenshots and animated GIFs in your pull request whenever possible
- End all files with a newline
- Avoid platform-dependent code

## Development Setup

### Prerequisites

- Node.js (v18+)
- npm or yarn
- Cloudflare account
- Wrangler CLI

### Setup Steps

```bash
# Clone your fork
git clone https://github.com/YOUR-USERNAME/CFlair-Counter.git
cd CFlair-Counter

# Install dependencies
npm install

# Create environment file
cp .dev.vars.example .dev.vars

# Edit .dev.vars with your settings
nano .dev.vars

# Create D1 database
npm run db:create

# Initialize database
npm run db:init

# Start development server
npm run dev
```

### Development Workflow

1. Create a new branch from `main`:
   ```bash
   git checkout -b feature/amazing-feature
   ```

2. Make your changes

3. Test your changes:
   ```bash
   npm run lint
   npm run type-check
   npm run test
   ```

4. Commit your changes:
   ```bash
   git commit -m 'Add some amazing feature'
   ```

5. Push to your fork:
   ```bash
   git push origin feature/amazing-feature
   ```

6. Open a Pull Request

## Coding Standards

### TypeScript

- Use TypeScript for all backend code
- Enable strict mode
- Provide type annotations for function parameters and return types
- Use interfaces for object shapes
- Avoid `any` types

### JavaScript

- Use ES6+ features
- Use `const` and `let` instead of `var`
- Use arrow functions where appropriate
- Use template literals for string concatenation
- Use destructuring when appropriate

### HTML/CSS

- Use semantic HTML5 elements
- Follow BEM naming convention for CSS classes
- Use CSS variables for theming
- Ensure responsive design (mobile-first)
- Test across different browsers

### Code Style

```typescript
// Good
interface Project {
  id: string;
  name: string;
  viewCount: number;
}

async function getProject(id: string): Promise<Project> {
  const result = await db.query('SELECT * FROM projects WHERE id = ?', [id]);
  return result.rows[0];
}

// Bad
async function getProject(id) {
  const result = await db.query('SELECT * FROM projects WHERE id = ?', [id]);
  return result.rows[0];
}
```

### File Organization

```
features/
├── feature-name/
│   ├── types.ts          # Type definitions
│   ├── utils.ts          # Utility functions
│   ├── feature.ts        # Main implementation
│   └── feature.test.ts   # Tests
```

## Commit Messages

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation only changes
- **style**: Changes that don't affect code meaning (white-space, formatting)
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **perf**: Performance improvement
- **test**: Adding missing tests
- **chore**: Changes to build process or auxiliary tools

### Examples

```
feat(admin): add project deletion functionality

Added DELETE endpoint for removing projects from the database.
Includes confirmation dialog and proper error handling.

Closes #123
```

```
fix(badge): correct color parameter validation

Fixed issue where invalid color values would crash the badge generator.
Now properly validates against allowed color list.

Fixes #456
```

## Pull Request Process

1. **Update Documentation**: Ensure README.md and relevant documentation is updated

2. **Update CHANGELOG**: Add your changes to CHANGELOG.md under "Unreleased"

3. **Test Thoroughly**:
   - All existing tests pass
   - New tests added for new features
   - Manual testing completed

4. **Clean Commits**:
   - Squash commits if necessary
   - Follow commit message guidelines

5. **Description**: Provide a clear description of:
   - What changed
   - Why it changed
   - How to test it
   - Related issues

6. **Request Review**: Tag relevant maintainers for review

7. **Address Feedback**: Make requested changes promptly

8. **Merge**: Once approved, maintainers will merge your PR

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Manual testing completed
- [ ] Unit tests added/updated
- [ ] Integration tests pass

## Screenshots
If applicable, add screenshots

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] Tests added that prove fix/feature works
- [ ] All tests passing
```

## Areas for Contribution

### High Priority

- [ ] Add comprehensive test suite
- [ ] Implement project deletion API endpoint
- [ ] Add bulk operations for admin panel
- [ ] Create analytics graphs/charts
- [ ] Add export functionality (JSON/CSV)

### Medium Priority

- [ ] Add project search/filter in admin
- [ ] Implement pagination for large project lists
- [ ] Add custom badge color support (hex codes)
- [ ] Create Docker container for local development
- [ ] Add i18n support

### Low Priority

- [ ] Add dark mode toggle
- [ ] Create CLI tool for management
- [ ] Add webhook notifications
- [ ] Implement A/B testing features
- [ ] Add more badge styles

## Questions?

Feel free to:
- Open an issue with the `question` label
- Email: [Your contact]
- Join our discussions on GitHub

## Recognition

Contributors will be:
- Added to CONTRIBUTORS.md
- Mentioned in release notes
- Given credit in relevant documentation

Thank you for contributing to CFlairCounter! 🎉

---

**Happy Coding!** ❤️
