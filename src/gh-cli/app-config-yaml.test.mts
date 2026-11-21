import { describe, expect, it } from 'vitest'

import { loadAppConfig, type AppConfigFs } from './app-config.mts'

const PEM = '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----'

const load = (files: Record<string, string>) => {
  const fs: AppConfigFs = { readText: (path) => files[path], mode: () => 0o600 }
  return loadAppConfig({ HOME: '/home/u' }, fs, '/cfg', 'linux')
}

describe('loadAppConfig from YAML', () => {
  it('reads app.yaml and app.yml with comments, as the JSON file would be read', () => {
    const text = '# the App\nappId: "9"\ninstallationId: 5\nprivateKeyPath: key.pem\n'
    for (const name of ['app.yaml', 'app.yml']) {
      expect(load({ [`/cfg/${name}`]: text, '/cfg/key.pem': PEM })).toMatchObject({
        appId: '9',
        installationId: '5',
        privateKey: PEM,
        source: `/cfg/${name}`,
      })
    }
  })

  it('fails when the App config is kept in two formats', () => {
    for (const other of ['/cfg/app.json', '/cfg/app.yml']) {
      const files = { '/cfg/app.yaml': 'appId: "1"', [other]: '{"appId":"2"}', '/cfg/app.pem': PEM }
      expect(() => load(files)).toThrow(
        expect.objectContaining({
          name: 'AppAuthError',
          message: expect.stringContaining('/cfg/app.yaml'),
        }),
      )
      expect(() => load(files)).toThrow(
        expect.objectContaining({ message: expect.stringContaining(other) }),
      )
    }
  })

  it('fails naming the file and the line of invalid YAML', () => {
    expect(() => load({ '/cfg/app.yaml': 'appId: "1"\nappId: "2"\n' })).toThrow(
      /\/cfg\/app\.yaml.* is not valid YAML \(.* at line 2\)/u,
    )
  })

  it('fails when the top level is not a mapping, and for an empty file as for JSON', () => {
    for (const text of ['- appId\n', '']) {
      expect(() => load({ '/cfg/app.yaml': text })).toThrow(/must be a YAML mapping/u)
    }
    expect(() => load({ '/cfg/app.json': '' })).toThrow(/is not valid JSON/u)
    expect(() => load({ '/cfg/app.json': '[]' })).toThrow(/must be a JSON object/u)
  })

  it('rejects a number where a string is needed, as the JSON file does', () => {
    const json = () => load({ '/cfg/app.json': '{"appId":"1","privateKeyPath":3}' })
    const yaml = () => load({ '/cfg/app.yaml': 'appId: "1"\nprivateKeyPath: 3\n' })
    expect(json).toThrow(/privateKeyPath must be a non-empty string/u)
    expect(yaml).toThrow(/privateKeyPath must be a non-empty string/u)
  })
})
