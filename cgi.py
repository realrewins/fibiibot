from email.utils import unquote
import email.message

def parse_header(line):
    """Parse a Content-type like header.
    Return the main content-type and a dictionary of options.
    """
    msg = email.message.Message()
    msg['content-type'] = line
    return msg.get_content_type(), dict(msg.get_params())