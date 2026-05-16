require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { ping } = require('minecraft-protocol')

const host = process.env.MC_HOST || 'Marcadia.playat.ch'
const port = parseInt(process.env.MC_PORT || '25565', 10)

ping({ host, port }, (err, result) => {
  if (err) {
    console.error('[ping error]', err)
    process.exit(1)
  }
  const mods = result.modinfo?.modList || []
  const out = path.join(__dirname, 'mods.json')
  fs.writeFileSync(out, JSON.stringify(mods, null, 2))
  console.log(`[ping] version=${result.version?.name} protocol=${result.version?.protocol} mods=${mods.length}`)
  console.log(`[ping] wrote ${mods.length} mods to ${out}`)
})
