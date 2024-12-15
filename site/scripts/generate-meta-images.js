const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const matter = require('gray-matter');
const glob = require('glob');
const sidebars = require('../sidebars');

function getBreadcrumbs(file, sidebars) {
  const docId = file.replace(/\.md$/, '');
  const breadcrumbs = [];

  function traverse(items, parentLabel = null) {
    for (const item of items) {
      if (item.type === 'doc' && item.id === docId) {
        if (parentLabel) {
          breadcrumbs.unshift(parentLabel);
        }
        return true;
      } else if (item.type === 'category') {
        if (traverse(item.items || [], item.label)) {
          if (parentLabel) {
            breadcrumbs.unshift(parentLabel);
          }
          return true;
        }
      } else if (item.type === 'autogenerated' && item.dirName && file.startsWith(item.dirName + '/')) {
        if (parentLabel) {
          breadcrumbs.unshift(parentLabel);
        }
        return true;
      }
    }
    return false;
  }

  traverse(sidebars.promptfoo);
  return breadcrumbs.join(' › ');
}

async function generateMetaImages() {
  const docsDir = path.join(__dirname, '..', 'docs');
  const outputDir = path.join(__dirname, '..', 'static/img/meta/docs');
  const templatePath = path.join(__dirname, '..', 'static/img/meta/docs-template.html');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const template = fs.readFileSync(templatePath, 'utf8');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630 });

  try {
    const files = glob.sync('**/*.md', { cwd: docsDir });
    console.log(`Found ${files.length} markdown files`);

    for (const file of files) {
      const filePath = path.join(docsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const { data: frontMatter, content: markdown } = matter(content);

      const existingImage = frontMatter.image?.replace(/^\//, '');
      if (existingImage && fs.existsSync(path.join(__dirname, '..', existingImage))) {
        console.log(`Skipping ${file} - already has image: ${existingImage}`);
        continue;
      }

      const title = frontMatter.title || markdown.match(/^#\s+(.+)/m)?.[1] || path.basename(file, '.md');

      const breadcrumbs = getBreadcrumbs(file, sidebars);

      const preview = markdown
        .replace(/^#.*$/m, '')
        .replace(/^(?:import|require).*$/gm, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/`[^`]+`/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[#\[\]*]/g, '')
        .trim()
        .split('\n')
        .filter(line => line.trim() && !line.trim().startsWith('import'))
        .slice(0, 3)
        .join(' ')
        .replace(/\s+/g, ' ')
        .slice(0, 200) + '...';

      const safeFilename = file.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.png';
      const outputPath = path.join(outputDir, safeFilename);
      const relativePath = path.join('img/meta/docs', safeFilename);

      const html = template
        .replace('{{title}}', title)
        .replace('{{breadcrumbs}}', breadcrumbs)
        .replace('{{preview}}', preview);
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.screenshot({
        path: outputPath,
        type: 'png'
      });
      console.log(`Generated image for ${file} at ${outputPath}`);

      const newFrontMatter = {
        ...frontMatter,
        image: '/' + relativePath.replace(/\\/g, '/'),
      };

      const updatedContent = matter.stringify(markdown, newFrontMatter);
      fs.writeFileSync(filePath, updatedContent);
    }
  } finally {
    await browser.close();
  }
}

generateMetaImages().catch(console.error);
