module.exports.parseMethod = function (header, socket , req) {
  let pointer = 0;

  switch (header[pointer]) {
    case 0x47: // G
    switch (header[pointer + 1]) {
      case 0x45: // E
      switch (header[pointer + 2]) {
        case 0x54: // T
        switch (header[pointer + 3]) {
          case 0x20: // Space
            req.method = 'GET';
            req.pointer = pointer + 4;
            break;
          default:
            socket.destroy();
            break;
        }
          break;
        default:
          socket.destroy();
          break;
      }
        break;
      default:
        socket.destroy();
        break;
    }
      break;
    case 0x50: // P
    switch (header[pointer + 1]) {
      case 0x4F: // O
      switch (header[pointer + 2]) {
        case 0x53: // S
        switch (header[pointer + 3]) {
          case 0x54: // T
          switch (header[pointer + 4]) {
            case 0x20: // Space
              req.method = 'POST';
              req.pointer = pointer + 5;
              break;
            default:
              socket.destroy();
              break;
          }
            break;
          default:
            socket.destroy();
            break;
        }
          break;
        default:
          socket.destroy();
          break;
      }
        break;
      case 0x55: // U
      switch (header[pointer + 2]) {
        case 0x54: // T
        switch (header[pointer + 3]) {
          case 0x20: // Space
            req.method = 'PUT';
            req.pointer = pointer + 4;
            break;
          default:
            socket.destroy();
            break;
        }
          break;
        default:
          socket.destroy();
          break;
      }
        break;
      case 0x41: // A
      switch (header[pointer + 2]) {
        case 0x54: // T
        switch (header[pointer + 3]) {
          case 0x43: // C
          switch (header[pointer + 4]) {
            case 0x48: // H
            switch (header[pointer + 5]) {
              case 0x20: // Space
                req.method = 'PATCH';
                req.pointer = pointer + 6;
                break;
              default:
                socket.destroy();
                break;
            }
              break;
            default:
              socket.destroy();
              break;
          }
            break;
          default:
            socket.destroy();
            break;
        }
          break;
        default:
          socket.destroy();
          break;
      }
        break;
      default:
        socket.destroy();
        break;
    }
      break;
    case 0x44: // D
    switch (header[pointer + 1]) {
      case 0x45: // E
      switch (header[pointer + 2]) {
        case 0x4C: // L
        switch (header[pointer + 3]) {
          case 0x45: // E
          switch (header[pointer + 4]) {
            case 0x54: // T
            switch (header[pointer + 5]) {
              case 0x45: // E
              switch (header[pointer + 6]) {
                case 0x20: // Space
                  req.method = 'DELETE';
                  req.pointer = pointer + 7;
                  break;
                default:
                  socket.destroy();
                  break;
              }
                break;
              default:
                socket.destroy();
                break;
            }
              break;
            default:
              socket.destroy();
              break;
          }
            break;
          default:
            socket.destroy();
            break;
        }
          break;
        default:
          socket.destroy();
          break;
      }
        break;
      default:
        socket.destroy();
        break;
    }
      break;
    default:
      socket.destroy();
      break;
  }


  return req;
};

module.exports.parseVersion = function (header, socket, req) {
  let p = req.pointer;

  // 1. المسار الخطي الإجباري: التحقق من "HTTP/1."
  if (
    header[p] === 0x48 &&     // H
    header[p + 1] === 0x54 && // T
    header[p + 2] === 0x54 && // T
    header[p + 3] === 0x50 && // P
    header[p + 4] === 0x2F && // /
    header[p + 5] === 0x31 && // 1
    header[p + 6] === 0x2E    // .
  ) {
    
    // 2. نقطة التفرع: التحقق من الإصدار "1" أو "0"
    switch (header[p + 7]) {
      case 0x31: // 1
        req.version = 'HTTP/1.1';
        break;
      case 0x30: // 0
        req.version = 'HTTP/1.0';
        break;
      default:
        socket.destroy();
        return req;
    }

    // 3. قفلة السطر: التحقق الصارم من الـ CRLF (\r\n)
    if (header[p + 8] === 0x0D && header[p + 9] === 0x0A) {
      req.pointer += 10; // تحديث البوينتر عشان يبدأ من أول سطر في الـ Headers
    } else {
      socket.destroy();
    }
    
  } else {
    socket.destroy();
  }

  return req;
};