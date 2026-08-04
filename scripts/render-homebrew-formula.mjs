#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    output: { type: 'string' },
    owner: { type: 'string' },
    repo: { type: 'string' },
    sha256: { type: 'string' },
    version: { type: 'string' },
  },
});
const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, 'package.json');
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

const version = args.version || packageJson.version;
const sha256 = args.sha256;
const outputPath = path.resolve(rootDir, args.output || 'packaging/homebrew-tap/Formula/collabmd.rb');
const owner = args.owner || 'andes90';
const repo = args.repo || packageJson.name;

if (!version) {
  throw new Error('Missing version. Pass --version or set package.json version.');
}

if (!sha256) {
  throw new Error('Missing sha256. Pass --sha256 <checksum>.');
}

if (!/^[a-f0-9]{64}$/i.test(sha256)) {
  throw new Error(`Invalid sha256: ${sha256}`);
}

if (version !== packageJson.version) {
  throw new Error(
    `Version mismatch: package.json is ${packageJson.version}, but --version was ${version}.`,
  );
}

const className = toFormulaClassName(packageJson.name);
const formula = `class ${className} < Formula
  desc "Collaborative markdown vault server"
  homepage "https://github.com/${owner}/${repo}"
  url "https://github.com/${owner}/${repo}/archive/refs/tags/v${version}.tar.gz"
  sha256 "${sha256}"
  license "${packageJson.license}"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args(prefix: false), "--include=dev"
    system "npm", "run", "build"
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/${packageJson.name}"
  end

  test do
    require "timeout"

    (testpath/"vault").mkpath
    (testpath/"vault/test.md").write("# Hello from Homebrew\\n")

    port = free_port
    log_path = testpath/"collabmd.log"
    pid = spawn(
      bin/"${packageJson.name}",
      testpath/"vault",
      "--no-tunnel",
      "--host", "127.0.0.1",
      "--port", port.to_s,
      out: log_path,
      err: log_path
    )

    health_output = nil

    Timeout.timeout(15) do
      loop do
        health_output = shell_output("curl -fsS http://127.0.0.1:#{port}/health", 2).strip
        break if health_output == "ok"
      rescue ErrorDuringExecution
        sleep 1
      else
        sleep 1 if health_output != "ok"
      end
    end

    assert_equal "ok", health_output

    asset_response = shell_output("curl -i -fsS http://127.0.0.1:#{port}/assets/css/style.css", 2)
    assert_match "Content-Type: text/css; charset=utf-8", asset_response
    assert_match "--color-bg", asset_response
  ensure
    begin
      Process.kill("TERM", pid)
    rescue Errno::ESRCH
      nil
    end

    begin
      Process.wait(pid)
    rescue Errno::ECHILD
      nil
    end
  end
end
`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, formula);

function toFormulaClassName(name) {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}
