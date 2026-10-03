import { createSocket } from "node:dgram";
/** Loopback-only DNS fixture. Exercises TXT wire queries; it does not prove control of an external domain. */
export async function localSenderDns(records: Map<string, string>) {
  const socket = createSocket("udp4");
  socket.on("message", (query, peer) => {
    try {
      let offset = 12; const labels: string[] = [];
      while (query[offset]) { const n = query[offset++]; if (n > 63 || offset + n >= query.length) return; labels.push(query.subarray(offset, offset + n).toString("ascii")); offset += n; }
      offset++; if (offset + 4 > query.length) return;
      const name = labels.join(".").toLowerCase(), value = records.get(name), isTxt = query.readUInt16BE(offset) === 16;
      const header = Buffer.alloc(12); query.copy(header, 0, 0, 2); header.writeUInt16BE(0x8180, 2); header.writeUInt16BE(1, 4); header.writeUInt16BE(value && isTxt ? 1 : 0, 6);
      const question = query.subarray(12, offset + 4);
      const answer: Buffer[] = [header, question];
      if (value && isTxt) { const txt = Buffer.from(value), record = Buffer.alloc(13); record.writeUInt16BE(0xc00c, 0); record.writeUInt16BE(16, 2); record.writeUInt16BE(1, 4); record.writeUInt32BE(0, 6); record.writeUInt16BE(txt.length + 1, 10); record[12] = txt.length; answer.push(record, txt); }
      socket.send(Buffer.concat(answer), peer.port, peer.address);
    } catch { /* Ignore malformed datagrams. */ }
  });
  await new Promise<void>(resolve => socket.bind(0, "127.0.0.1", resolve));
  const address = socket.address();
  return { server: "127.0.0.1:" + address.port, close: () => new Promise<void>(resolve => socket.close(resolve)) };
}
