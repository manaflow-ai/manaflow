function H1({ children }: { children: React.ReactNode }) {
  return <h1 className="text-xl font-bold">{children}</h1>;
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

export const PrivacyPolicyScreen = ({
  appUrl,
  lastUpdated,
  company,
  contactEmail,
}: {
  appUrl: string;
  lastUpdated: string;
  company: string;
  contactEmail: string;
}) => {
  return (
    <div className="h-screen overflow-auto">
      <div className="px-4">
        {/* only show title on web since mobile has navigator title */}
        <H1>Privacy Policy</H1>
        <Paragraph>{company} PRIVACY POLICY</Paragraph>
        <Paragraph>
          {company} (the "Company") is committed to maintaining robust privacy
          protections for its users. Our Privacy Policy ("Privacy Policy") is
          designed to help you understand how we collect, use and safeguard the
          information you provide to us and to assist you in making informed
          decisions when using our Service.
        </Paragraph>
        <Paragraph>
          For purposes of this Agreement, "Site" refers to the Company's
          website, which can be accessed at {appUrl}.
        </Paragraph>
        <Paragraph>
          "Service" refers to the Company's services accessed via the Site, in
          which users can run AI-powered coding agents (such as Claude Code,
          Codex CLI, Gemini CLI, and others) in parallel across multiple tasks,
          with isolated development environments provided via containerized
          sandboxes. The terms "we," "us," and "our" refer to the Company.
          "You" refers to you, as a user of our Site or our Service. By
          accessing our Site or our Service, you accept our Privacy Policy and
          Terms of Use (found here: {appUrl}/terms-of-service), and you consent
          to our collection, storage, use and disclosure of your Personal
          Information as described in this Privacy Policy.
        </Paragraph>
        <Paragraph>I. INFORMATION WE COLLECT</Paragraph>
        <Paragraph>
          We collect "Non-Personal Information" and "Personal Information."
          Non-Personal Information includes information that cannot be used to
          personally identify you, such as anonymous usage data, general
          demographic information we may collect, referring/exit pages and URLs,
          platform types, preferences you submit and preferences that are
          generated based on the data you submit and number of clicks. Personal
          Information includes your email address, name, and account
          information, which you submit to us through the registration process
          at the Site.
        </Paragraph>
        <Paragraph>1. Information collected via Technology</Paragraph>
        <Paragraph>
          To activate the Service you do not need to submit any Personal
          Information other than your email address. However, in an effort to
          improve the quality of the Service, we track information provided to
          us by your browser or by our software application when you view or use
          the Service, such as the website you came from (known as the
          "referring URL"), the type of browser you use, the device from which
          you connected to the Service, the time and date of access, and other
          information that does not personally identify you. We track this
          information using cookies and similar technologies. The Company may
          collect the following information via technology:
        </Paragraph>
        <Paragraph>- IP address and approximate location (city, country)</Paragraph>
        <Paragraph>- Operating system and browser information</Paragraph>
        <Paragraph>- Page views and click data</Paragraph>
        <Paragraph>- Session recordings and interaction data (via PostHog)</Paragraph>
        <Paragraph>- User ID and usage patterns</Paragraph>
        <Paragraph>
          The Company may use both persistent and session cookies; persistent
          cookies remain on your computer after you close your session and until
          you delete them, while session cookies expire when you close your
          browser.
        </Paragraph>
        <Paragraph>2. Information you provide by registering for an account</Paragraph>
        <Paragraph>
          In addition to the information provided automatically by your browser
          when you visit the Site, to become a subscriber to the Service you
          will need to create a personal profile. You can create a profile by
          registering with the Service using Google, GitHub, or Facebook OAuth,
          or by entering your email address and creating a password. By
          registering, you are authorizing us to collect, store and use your
          email address and account information in accordance with this Privacy
          Policy.
        </Paragraph>
        <Paragraph>3. Information related to your use of the Service</Paragraph>
        <Paragraph>
          When you use the Service, we may collect and process the following
          types of data:
        </Paragraph>
        <Paragraph>
          - Source code and files you provide to the AI coding agents
        </Paragraph>
        <Paragraph>
          - Prompts, instructions, and conversations with AI agents
        </Paragraph>
        <Paragraph>
          - Container and sandbox session data
        </Paragraph>
        <Paragraph>
          - API keys and credentials you configure for third-party services
          (stored securely and used only to facilitate your use of the Service)
        </Paragraph>
        <Paragraph>
          - Git repository information and code changes
        </Paragraph>
        <Paragraph>4. Children's Privacy</Paragraph>
        <Paragraph>
          The Site and the Service are not directed to anyone under the age of
          13. The Site does not knowingly collect or solicit information from
          anyone under the age of 13, or allow anyone under the age of 13 to
          sign up for the Service. In the event that we learn that we have
          gathered personal information from anyone under the age of 13 without
          the consent of a parent or guardian, we will delete that information
          as soon as possible. If you believe we have collected such
          information, please contact us at {contactEmail}.
        </Paragraph>
        <Paragraph>II. THIRD-PARTY SERVICES</Paragraph>
        <Paragraph>
          The Service integrates with and relies on various third-party services
          to provide its functionality. By using the Service, you acknowledge
          that your data may be processed by these third parties in accordance
          with their respective privacy policies:
        </Paragraph>
        <Paragraph>AI Service Providers:</Paragraph>
        <Paragraph>
          - Anthropic (Claude) - for AI coding assistance
        </Paragraph>
        <Paragraph>
          - OpenAI - for AI coding assistance
        </Paragraph>
        <Paragraph>
          - Google (Gemini) - for AI coding assistance
        </Paragraph>
        <Paragraph>
          - Other AI providers as made available through the Service
        </Paragraph>
        <Paragraph>
          When you use AI coding agents through our Service, your prompts, code,
          and related data may be sent to these providers. Please review each
          provider's privacy policy for details on how they handle your data.
        </Paragraph>
        <Paragraph>Sandbox and Infrastructure Providers:</Paragraph>
        <Paragraph>
          - Morph (morph.so) - containerized development environments
        </Paragraph>
        <Paragraph>
          - Freestyle (freestyle.sh) - containerized development environments
        </Paragraph>
        <Paragraph>
          - Amazon Web Services (AWS) - cloud infrastructure
        </Paragraph>
        <Paragraph>
          - Vercel - hosting and deployment
        </Paragraph>
        <Paragraph>
          - Convex (convex.dev) - database and backend services
        </Paragraph>
        <Paragraph>
          - Cloudflare - content delivery and security
        </Paragraph>
        <Paragraph>Analytics, Monitoring, and Session Recording:</Paragraph>
        <Paragraph>
          - PostHog - analytics, session replay, and heat mapping. PostHog may
          collect: IP address, city, country, email address, operating system,
          page views, clicks, usage data, and User ID.
        </Paragraph>
        <Paragraph>
          - Sentry - error tracking and performance monitoring. Sentry may
          collect: error logs, stack traces, device information, and usage data.
        </Paragraph>
        <Paragraph>Authentication Providers:</Paragraph>
        <Paragraph>
          - Google OAuth - for account authentication
        </Paragraph>
        <Paragraph>
          - GitHub OAuth - for account authentication
        </Paragraph>
        <Paragraph>
          - Facebook OAuth - for account authentication
        </Paragraph>
        <Paragraph>
          Each of these services has its own privacy policy governing the
          collection and use of your data. We encourage you to review the
          privacy policies of these third-party services.
        </Paragraph>
        <Paragraph>III. HOW WE USE AND SHARE INFORMATION</Paragraph>
        <Paragraph>
          Personal Information: Except as otherwise stated in this Privacy
          Policy, we do not sell, trade, rent or otherwise share for marketing
          purposes your Personal Information with third parties without your
          consent. We do share Personal Information with vendors who are
          performing services for the Company, such as the servers for our email
          communications who are provided access to user’s email address for
          purposes of sending emails from us. Those vendors use your Personal
          Information only at our direction and in accordance with our Privacy
          Policy. In general, the Personal Information you provide to us is used
          to help us communicate with you. For example, we use Personal
          Information to contact users in response to questions, solicit
          feedback from users, provide technical support, and inform users about
          promotional offers. We may share Personal Information with outside
          parties if we have a good-faith belief that access, use, preservation
          or disclosure of the information is reasonably necessary to meet any
          applicable legal process or enforceable governmental request; to
          enforce applicable Terms of Service, including investigation of
          potential violations; address fraud, security or technical concerns;
          or to protect against harm to the rights, property, or safety of our
          users or the public as required or permitted by law.
        </Paragraph>
        <Paragraph>Non-Personal Information</Paragraph>
        <Paragraph>
          In general, we use Non-Personal Information to help us improve the
          Service and customize the user experience. We also aggregate
          Non-Personal Information in order to track trends and analyze use
          patterns on the Site. This Privacy Policy does not limit in any way
          our use or disclosure of Non-Personal Information and we reserve the
          right to use and disclose such Non-Personal Information to our
          partners, advertisers and other third parties at our discretion. In
          the event we undergo a business transaction such as a merger,
          acquisition by another company, or sale of all or a portion of our
          assets, your Personal Information may be among the assets transferred.
          You acknowledge and consent that such transfers may occur and are
          permitted by this Privacy Policy, and that any acquirer of our assets
          may continue to process your Personal Information as set forth in this
          Privacy Policy. If our information practices change at any time in the
          future, we will post the policy changes to the Site so that you may
          opt out of the new information practices. We suggest that you check
          the Site periodically if you are concerned about how your information
          is used.
        </Paragraph>
        <Paragraph>IV. HOW WE PROTECT INFORMATION</Paragraph>
        <Paragraph>
          We implement security measures designed to protect your information
          from unauthorized access. Your account is protected by your account
          password and we urge you to take steps to keep your personal
          information safe by not disclosing your password and by logging out of
          your account after each use. We further protect your information from
          potential security breaches by implementing certain technological
          security measures including encryption, firewalls and secure socket
          layer technology. However, these measures do not guarantee that your
          information will not be accessed, disclosed, altered or destroyed by
          breach of such firewalls and secure server software. By using our
          Service, you acknowledge that you understand and agree to assume these
          risks.
        </Paragraph>
        <Paragraph>
          V. YOUR RIGHTS REGARDING THE USE OF YOUR PERSONAL INFORMATION
        </Paragraph>
        <Paragraph>
          You have the right at any time to prevent us from contacting you for
          marketing purposes. When we send a promotional communication to a
          user, the user can opt out of further promotional communications by
          following the unsubscribe instructions provided in each promotional
          e-mail. You can also indicate that you do not wish to receive
          marketing communications from us in the Settings section of the Site.
          Please note that notwithstanding the promotional preferences you
          indicate by either unsubscribing or opting out in the Settings section
          of the Site, we may continue to send you administrative emails
          including, for example, periodic updates to our Privacy Policy.
        </Paragraph>
        <Paragraph>
          Depending on your location, you may have additional rights under
          applicable data protection laws (such as GDPR or CCPA), including:
        </Paragraph>
        <Paragraph>
          - Right to Access: You may request a copy of the personal data we hold
          about you.
        </Paragraph>
        <Paragraph>
          - Right to Rectification: You may request that we correct any
          inaccurate or incomplete personal data.
        </Paragraph>
        <Paragraph>
          - Right to Erasure: You may request that we delete your personal data,
          subject to certain exceptions.
        </Paragraph>
        <Paragraph>
          - Right to Data Portability: You may request a copy of your data in a
          structured, commonly used, machine-readable format.
        </Paragraph>
        <Paragraph>
          - Right to Restrict Processing: You may request that we limit the
          processing of your personal data in certain circumstances.
        </Paragraph>
        <Paragraph>
          - Right to Object: You may object to the processing of your personal
          data for certain purposes.
        </Paragraph>
        <Paragraph>
          To exercise any of these rights, please contact us at {contactEmail}.
          We will respond to your request within the timeframe required by
          applicable law.
        </Paragraph>
        <Paragraph>VI. LINKS TO OTHER WEBSITES</Paragraph>
        <Paragraph>
          As part of the Service, we may provide links to or compatibility with
          other websites or applications. However, we are not responsible for
          the privacy practices employed by those websites or the information or
          content they contain. This Privacy Policy applies solely to
          information collected by us through the Site and the Service.
          Therefore, this Privacy Policy does not apply to your use of a third
          party website accessed by selecting a link on our Site or via our
          Service. To the extent that you access or use the Service through or
          on another website or application, then the privacy policy of that
          other website or application will apply to your access or use of that
          site or application. We encourage our users to read the privacy
          statements of other websites before proceeding to use them.
        </Paragraph>
        <Paragraph>VII. CHANGES TO OUR PRIVACY POLICY</Paragraph>
        <Paragraph>
          The Company reserves the right to change this policy and our Terms of
          Service at any time. We will notify you of significant changes to our
          Privacy Policy by sending a notice to the primary email address
          specified in your account or by placing a prominent notice on our
          site. Significant changes will go into effect 30 days following such
          notification. Non-material changes or clarifications will take effect
          immediately. You should periodically check the Site and this privacy
          page for updates.
        </Paragraph>
        <Paragraph>VIII. CONTACT US</Paragraph>
        <Paragraph>
          If you have any questions regarding this Privacy Policy or the
          practices of this Site, please contact us by sending an email to
          {contactEmail}. Last Updated: This Privacy Policy was last updated on{" "}
          {lastUpdated}.
        </Paragraph>
        <Paragraph>IX. DATA RETENTION</Paragraph>
        <Paragraph>
          We retain your personal information for as long as your account is
          active or as needed to provide you with the Service. We may also
          retain and use your information as necessary to comply with legal
          obligations, resolve disputes, and enforce our agreements.
        </Paragraph>
        <Paragraph>
          Container and sandbox session data is typically deleted shortly after
          your session ends. Code and files processed by AI agents are not
          retained by us beyond the immediate processing required, though
          third-party AI providers may have their own retention policies.
        </Paragraph>
        <Paragraph>
          You may request deletion of your account and associated data at any
          time by contacting us at {contactEmail}.
        </Paragraph>
      </div>
    </div>
  );
};

export const TermsOfServiceScreen = ({
  appUrl,
  company,
  contactEmail,
}: {
  appUrl: string;
  company: string;
  contactEmail: string;
}) => {
  return (
    <div className="h-screen overflow-auto">
      <div className="px-4">
        {/* only show title on web since mobile has navigator title */}
        <H1>Terms of Service</H1>

        <Paragraph>Version 1.0</Paragraph>

        <Paragraph>Last revised on: 12/2, 2025</Paragraph>

        <Paragraph>
          The website located at {appUrl} (the “Site”) is a copyrighted work
          belonging to {company} (“Company”, “us”, “our”, and “we”). Certain
          features of the Site may be subject to additional guidelines, terms,
          or rules, which will be posted on the Site in connection with such
          features. All such additional terms, guidelines, and rules are
          incorporated by reference into these Terms.
        </Paragraph>

        <Paragraph>
          These Terms of Use (these “Terms”) set forth the legally binding terms
          and conditions that govern your use of the Site. By accessing or using
          the Site, you are accepting these Terms (on behalf of yourself or the
          entity that you represent), and you represent and warrant that you
          have the right, authority, and capacity to enter into these Terms (on
          behalf of yourself or the entity that you represent). you may not
          access or use the Site or accept the Terms if you are not at least 18
          years old. If you do not agree with all of the provisions of these
          Terms, do not access and/or use the Site.
        </Paragraph>

        <Paragraph>
          PLEASE BE AWARE THAT SECTION 10.2 CONTAINS PROVISIONS GOVERNING HOW TO
          RESOLVE DISPUTES BETWEEN YOU AND COMPANY. AMONG OTHER THINGS, SECTION
          10.2 INCLUDES AN AGREEMENT TO ARBITRATE WHICH REQUIRES, WITH LIMITED
          EXCEPTIONS, THAT ALL DISPUTES BETWEEN YOU AND US SHALL BE RESOLVED BY
          BINDING AND FINAL ARBITRATION. SECTION 10.2 ALSO CONTAINS A CLASS
          ACTION AND JURY TRIAL WAIVER. PLEASE READ SECTION 10.2 CAREFULLY.
        </Paragraph>

        <Paragraph>
          UNLESS YOU OPT OUT OF THE AGREEMENT TO ARBITRATE WITHIN 30 DAYS: (1)
          YOU WILL ONLY BE PERMITTED TO PURSUE DISPUTES OR CLAIMS AND SEEK
          RELIEF AGAINST US ON AN INDIVIDUAL BASIS, NOT AS A PLAINTIFF OR CLASS
          MEMBER IN ANY CLASS OR REPRESENTATIVE ACTION OR PROCEEDING AND YOU
          WAIVE YOUR RIGHT TO PARTICIPATE IN A CLASS ACTION LAWSUIT OR
          CLASS-WIDE ARBITRATION; AND (2) YOU ARE WAIVING YOUR RIGHT TO PURSUE
          DISPUTES OR CLAIMS AND SEEK RELIEF IN A COURT OF LAW AND TO HAVE A
          JURY TRIAL.
        </Paragraph>

        <Paragraph>Accounts</Paragraph>

        <Paragraph>
          Account Creation. In order to use certain features of the Site, you
          must register for an account (“Account”) and provide certain
          information about yourself as prompted by the account registration
          form. You represent and warrant that: (a) all required registration
          information you submit is truthful and accurate; (b) you will maintain
          the accuracy of such information. You may delete your Account at any
          time, for any reason, by following the instructions on the Site.
          Company may suspend or terminate your Account in accordance with
          Section 8.{" "}
        </Paragraph>

        <Paragraph>
          Account Responsibilities. You are responsible for maintaining the
          confidentiality of your Account login information and are fully
          responsible for all activities that occur under your Account. You
          agree to immediately notify Company of any unauthorized use, or
          suspected unauthorized use of your Account or any other breach of
          security. Company cannot and will not be liable for any loss or damage
          arising from your failure to comply with the above requirements.
        </Paragraph>

        <Paragraph>Access to the Site </Paragraph>

        <Paragraph>
          License. Subject to these Terms, Company grants you a
          non-transferable, non-exclusive, revocable, limited license to use and
          access the Site for your personal or internal business purposes,
          including commercial use in connection with your software development
          activities.
        </Paragraph>

        <Paragraph>
          Certain Restrictions. The rights granted to you in these Terms are
          subject to the following restrictions: (a) you shall not license,
          sell, rent, lease, transfer, assign, distribute, host, or otherwise
          commercially exploit the Site, whether in whole or in part, or any
          content displayed on the Site; (b) you shall not modify, make
          derivative works of, disassemble, reverse compile or reverse engineer
          any part of the Site; (c) you shall not access the Site in order to
          build a similar or competitive website, product, or service; and (d)
          except as expressly stated herein, no part of the Site may be copied,
          reproduced, distributed, republished, downloaded, displayed, posted or
          transmitted in any form or by any means. Unless otherwise indicated,
          any future release, update, or other addition to functionality of the
          Site shall be subject to these Terms. All copyright and other
          proprietary notices on the Site (or on any content displayed on the
          Site) must be retained on all copies thereof.
        </Paragraph>

        <Paragraph>
          Modification. Company reserves the right, at any time, to modify,
          suspend, or discontinue the Site (in whole or in part) with or without
          notice to you. You agree that Company will not be liable to you or to
          any third party for any modification, suspension, or discontinuation
          of the Site or any part thereof.
        </Paragraph>

        <Paragraph>
          No Support or Maintenance. You acknowledge and agree that Company will
          have no obligation to provide you with any support or maintenance in
          connection with the Site.
        </Paragraph>

        <Paragraph>
          Ownership. Excluding any User Content that you may provide (defined
          below), you acknowledge that all the intellectual property rights,
          including copyrights, patents, trade marks, and trade secrets, in the
          Site and its content are owned by Company or Company’s suppliers.
          Neither these Terms (nor your access to the Site) transfers to you or
          any third party any rights, title or interest in or to such
          intellectual property rights, except for the limited access rights
          expressly set forth in Section 2.1. Company and its suppliers reserve
          all rights not granted in these Terms. There are no implied licenses
          granted under these Terms.
        </Paragraph>

        <Paragraph>
          Feedback. If you provide Company with any feedback or suggestions
          regarding the Site (“Feedback”), you hereby assign to Company all
          rights in such Feedback and agree that Company shall have the right to
          use and fully exploit such Feedback and related information in any
          manner it deems appropriate. Company will treat any Feedback you
          provide to Company as non-confidential and non-proprietary. You agree
          that you will not submit to Company any information or ideas that you
          consider to be confidential or proprietary.
        </Paragraph>

        <Paragraph>User Content</Paragraph>

        <Paragraph>
          User Content. “User Content” means any and all information and content
          that a user submits to, or uses with, the Site (e.g., content in the
          user’s profile or postings). You are solely responsible for your User
          Content. You assume all risks associated with use of your User
          Content, including any reliance on its accuracy, completeness or
          usefulness by others, or any disclosure of your User Content that
          personally identifies you or any third party. You hereby represent and
          warrant that your User Content does not violate our Acceptable Use
          Policy (defined in Section 3.3). You may not represent or imply to
          others that your User Content is in any way provided, sponsored or
          endorsed by Company. Since you alone are responsible for your User
          Content, you may expose yourself to liability if, for example, your
          User Content violates the Acceptable Use Policy. Company is not
          obligated to backup any User Content, and your User Content may be
          deleted at any time without prior notice. You are solely responsible
          for creating and maintaining your own backup copies of your User
          Content if you desire.
        </Paragraph>

        <Paragraph>
          License. You hereby grant (and you represent and warrant that you have
          the right to grant) to Company an irrevocable, nonexclusive,
          royalty-free and fully paid, worldwide license to reproduce,
          distribute, publicly display and perform, prepare derivative works of,
          incorporate into other works, and otherwise use and exploit your User
          Content, and to grant sublicenses of the foregoing rights, solely for
          the purposes of including your User Content in the Site. You hereby
          irrevocably waive (and agree to cause to be waived) any claims and
          assertions of moral rights or attribution with respect to your User
          Content.
        </Paragraph>

        <Paragraph>AI Services and Generated Content</Paragraph>

        <Paragraph>
          The Service provides access to AI-powered coding agents from various
          third-party providers including Anthropic (Claude), OpenAI, Google
          (Gemini), and others. By using these AI features, you acknowledge and
          agree to the following:
        </Paragraph>

        <Paragraph>
          Third-Party AI Terms. Your use of AI coding agents is subject to the
          terms and conditions of the respective AI providers. You are
          responsible for reviewing and complying with these third-party terms.
        </Paragraph>

        <Paragraph>
          Ownership of AI Output. You retain ownership of any code or content
          you create using AI assistance through the Service, subject to any
          applicable third-party AI provider terms. Company does not claim
          ownership of AI-generated output created at your direction.
        </Paragraph>

        <Paragraph>
          AI Accuracy Disclaimer. AI-generated code and suggestions may contain
          errors, security vulnerabilities, or inaccuracies. You are solely
          responsible for reviewing, testing, and validating any AI-generated
          code before use. Company makes no warranties regarding the accuracy,
          reliability, security, or fitness for purpose of AI-generated content.
        </Paragraph>

        <Paragraph>
          Data Sharing with AI Providers. When you use AI coding agents, your
          prompts, code, and related data may be transmitted to third-party AI
          providers. Please review our Privacy Policy and each provider's
          privacy policy for details.
        </Paragraph>

        <Paragraph>
          Acceptable Use Policy. The following terms constitute our "Acceptable
          Use Policy":
        </Paragraph>

        <Paragraph>
          You agree not to use the Site to collect, upload, transmit, display,
          or distribute any User Content (i) that violates any third-party
          right, including any copyright, trademark, patent, trade secret, moral
          right, privacy right, right of publicity, or any other intellectual
          property or proprietary right, (ii) that is unlawful, harassing,
          abusive, tortious, threatening, harmful, invasive of another’s
          privacy, vulgar, defamatory, false, intentionally misleading, trade
          libelous, pornographic, obscene, patently offensive, promotes racism,
          bigotry, hatred, or physical harm of any kind against any group or
          individual or is otherwise objectionable, (iii) that is harmful to
          minors in any way, or (iv) that is in violation of any law,
          regulation, or obligations or restrictions imposed by any third party.
        </Paragraph>

        <Paragraph>
          In addition, you agree not to: (i) upload, transmit, or distribute to
          or through the Site any computer viruses, worms, or any software
          intended to damage or alter a computer system or data; (ii) send
          through the Site unsolicited or unauthorized advertising, promotional
          materials, junk mail, spam, chain letters, pyramid schemes, or any
          other form of duplicative or unsolicited messages, whether commercial
          or otherwise; (iii) use the Site to harvest, collect, gather or
          assemble information or data regarding other users, including e-mail
          addresses, without their consent; (iv) interfere with, disrupt, or
          create an undue burden on servers or networks connected to the Site,
          or violate the regulations, policies or procedures of such networks;
          (v) attempt to gain unauthorized access to the Site (or to other
          computer systems or networks connected to or used together with the
          Site), whether through password mining or any other means; (vi) harass
          or interfere with any other user’s use and enjoyment of the Site; or
          (vi) use software or automated agents or scripts to produce multiple
          accounts on the Site, or to generate automated searches, requests, or
          queries to (or to strip, scrape, or mine data from) the Site
          (provided, however, that we conditionally grant to the operators of
          public search engines revocable permission to use spiders to copy
          materials from the Site for the sole purpose of and solely to the
          extent necessary for creating publicly available searchable indices of
          the materials, but not caches or archives of such materials, subject
          to the parameters set forth in our robots.txt file).
        </Paragraph>

        <Paragraph>
          Enforcement. We reserve the right (but have no obligation) to review,
          refuse and/or remove any User Content in our sole discretion, and to
          investigate and/or take appropriate action against you in our sole
          discretion if you violate the Acceptable Use Policy or any other
          provision of these Terms or otherwise create liability for us or any
          other person. Such action may include removing or modifying your User
          Content, terminating your Account in accordance with Section 8, and/or
          reporting you to law enforcement authorities.
        </Paragraph>

        <Paragraph>
          Indemnification. You agree to indemnify and hold Company (and its
          officers, employees, and agents) harmless, including costs and
          attorneys’ fees, from any claim or demand made by any third party due
          to or arising out of (a) your use of the Site, (b) your violation of
          these Terms, (c) your violation of applicable laws or regulations or
          (d) your User Content. Company reserves the right, at your expense, to
          assume the exclusive defense and control of any matter for which you
          are required to indemnify us, and you agree to cooperate with our
          defense of these claims. You agree not to settle any matter without
          the prior written consent of Company. Company will use reasonable
          efforts to notify you of any such claim, action or proceeding upon
          becoming aware of it.
        </Paragraph>

        <Paragraph>Third-Party Links & Ads; Other Users</Paragraph>

        <Paragraph>
          Third-Party Links & Ads. The Site may contain links to third-party
          websites and services, and/or display advertisements for third parties
          (collectively, “Third-Party Links & Ads”). Such Third-Party Links &
          Ads are not under the control of Company, and Company is not
          responsible for any Third-Party Links & Ads. Company provides access
          to these Third-Party Links & Ads only as a convenience to you, and
          does not review, approve, monitor, endorse, warrant, or make any
          representations with respect to Third-Party Links & Ads. You use all
          Third-Party Links & Ads at your own risk, and should apply a suitable
          level of caution and discretion in doing so. When you click on any of
          the Third-Party Links & Ads, the applicable third party’s terms and
          policies apply, including the third party’s privacy and data gathering
          practices. You should make whatever investigation you feel necessary
          or appropriate before proceeding with any transaction in connection
          with such Third-Party Links & Ads.
        </Paragraph>

        <Paragraph>
          Other Users. Each Site user is solely responsible for any and all of
          its own User Content. Since we do not control User Content, you
          acknowledge and agree that we are not responsible for any User
          Content, whether provided by you or by others. We make no guarantees
          regarding the accuracy, currency, suitability, appropriateness, or
          quality of any User Content. Your interactions with other Site users
          are solely between you and such users. You agree that Company will not
          be responsible for any loss or damage incurred as the result of any
          such interactions. If there is a dispute between you and any Site
          user, we are under no obligation to become involved.
        </Paragraph>

        <Paragraph>
          Release. You hereby release and forever discharge Company (and our
          officers, employees, agents, successors, and assigns) from, and hereby
          waive and relinquish, each and every past, present and future dispute,
          claim, controversy, demand, right, obligation, liability, action and
          cause of action of every kind and nature (including personal injuries,
          death, and property damage), that has arisen or arises directly or
          indirectly out of, or that relates directly or indirectly to, the Site
          (including any interactions with, or act or omission of, other Site
          users or any Third-Party Links & Ads). IF YOU ARE A CALIFORNIA
          RESIDENT, YOU HEREBY WAIVE CALIFORNIA CIVIL CODE SECTION 1542 IN
          CONNECTION WITH THE FOREGOING, WHICH STATES: “A GENERAL RELEASE DOES
          NOT EXTEND TO CLAIMS WHICH THE CREDITOR OR RELEASING PARTY DOES NOT
          KNOW OR SUSPECT TO EXIST IN HIS OR HER FAVOR AT THE TIME OF EXECUTING
          THE RELEASE, WHICH IF KNOWN BY HIM OR HER MUST HAVE MATERIALLY
          AFFECTED HIS OR HER SETTLEMENT WITH THE DEBTOR OR RELEASED PARTY.”
        </Paragraph>

        <Paragraph>Subscription and Billing</Paragraph>

        <Paragraph>
          Free and Paid Tiers. The Service offers both free and paid
          subscription tiers. Free tier users have access to limited features
          and usage quotas. Paid subscriptions provide additional features,
          higher usage limits, and priority support as described on our pricing
          page.
        </Paragraph>

        <Paragraph>
          Billing. If you subscribe to a paid tier, you agree to pay all
          applicable fees. Fees are billed in advance on a monthly or annual
          basis depending on your selected plan. All fees are non-refundable
          except as required by law or as explicitly stated in these Terms.
        </Paragraph>

        <Paragraph>
          Automatic Renewal. Paid subscriptions automatically renew at the end
          of each billing period unless you cancel before the renewal date. You
          may cancel your subscription at any time through your account
          settings.
        </Paragraph>

        <Paragraph>
          Price Changes. Company reserves the right to modify pricing at any
          time. Price changes will be communicated to you in advance and will
          take effect at the start of your next billing period.
        </Paragraph>

        <Paragraph>
          Usage Limits. Both free and paid tiers are subject to fair use limits
          on compute resources, API calls, storage, and other service
          capabilities. Exceeding these limits may result in throttling,
          suspension, or requirement to upgrade to a higher tier.
        </Paragraph>

        <Paragraph>Disclaimers </Paragraph>

        <Paragraph>
          THE SITE IS PROVIDED ON AN "AS-IS" AND "AS AVAILABLE" BASIS, AND
          COMPANY (AND OUR SUPPLIERS) EXPRESSLY DISCLAIM ANY AND ALL WARRANTIES
          AND CONDITIONS OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY,
          INCLUDING ALL WARRANTIES OR CONDITIONS OF MERCHANTABILITY, FITNESS FOR
          A PARTICULAR PURPOSE, TITLE, QUIET ENJOYMENT, ACCURACY, OR
          NON-INFRINGEMENT. WE (AND OUR SUPPLIERS) MAKE NO WARRANTY THAT THE
          SITE WILL MEET YOUR REQUIREMENTS, WILL BE AVAILABLE ON AN
          UNINTERRUPTED, TIMELY, SECURE, OR ERROR-FREE BASIS, OR WILL BE
          ACCURATE, RELIABLE, FREE OF VIRUSES OR OTHER HARMFUL CODE, COMPLETE,
          LEGAL, OR SAFE. IF APPLICABLE LAW REQUIRES ANY WARRANTIES WITH RESPECT
          TO THE SITE, ALL SUCH WARRANTIES ARE LIMITED IN DURATION TO 90 DAYS
          FROM THE DATE OF FIRST USE.
        </Paragraph>

        <Paragraph>
          SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OF IMPLIED WARRANTIES,
          SO THE ABOVE EXCLUSION MAY NOT APPLY TO YOU. SOME JURISDICTIONS DO NOT
          ALLOW LIMITATIONS ON HOW LONG AN IMPLIED WARRANTY LASTS, SO THE ABOVE
          LIMITATION MAY NOT APPLY TO YOU.
        </Paragraph>

        <Paragraph>Limitation on Liability</Paragraph>

        <Paragraph>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL COMPANY (OR
          OUR SUPPLIERS) BE LIABLE TO YOU OR ANY THIRD PARTY FOR ANY LOST
          PROFITS, LOST DATA, COSTS OF PROCUREMENT OF SUBSTITUTE PRODUCTS, OR
          ANY INDIRECT, CONSEQUENTIAL, EXEMPLARY, INCIDENTAL, SPECIAL OR
          PUNITIVE DAMAGES ARISING FROM OR RELATING TO THESE TERMS OR YOUR USE
          OF, OR INABILITY TO USE, THE SITE, EVEN IF COMPANY HAS BEEN ADVISED OF
          THE POSSIBILITY OF SUCH DAMAGES. ACCESS TO, AND USE OF, THE SITE IS AT
          YOUR OWN DISCRETION AND RISK, AND YOU WILL BE SOLELY RESPONSIBLE FOR
          ANY DAMAGE TO YOUR DEVICE OR COMPUTER SYSTEM, OR LOSS OF DATA
          RESULTING THEREFROM.
        </Paragraph>

        <Paragraph>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, NOTWITHSTANDING ANYTHING TO
          THE CONTRARY CONTAINED HEREIN, OUR LIABILITY TO YOU FOR ANY DAMAGES
          ARISING FROM OR RELATED TO THESE TERMS (FOR ANY CAUSE WHATSOEVER AND
          REGARDLESS OF THE FORM OF THE ACTION), WILL AT ALL TIMES BE LIMITED TO
          A MAXIMUM OF FIFTY US DOLLARS. THE EXISTENCE OF MORE THAN ONE CLAIM
          WILL NOT ENLARGE THIS LIMIT. YOU AGREE THAT OUR SUPPLIERS WILL HAVE NO
          LIABILITY OF ANY KIND ARISING FROM OR RELATING TO THESE TERMS.
        </Paragraph>

        <Paragraph>
          SOME JURISDICTIONS DO NOT ALLOW THE LIMITATION OR EXCLUSION OF
          LIABILITY FOR INCIDENTAL OR CONSEQUENTIAL DAMAGES, SO THE ABOVE
          LIMITATION OR EXCLUSION MAY NOT APPLY TO YOU.
        </Paragraph>

        <Paragraph>
          Term and Termination. Subject to this Section, these Terms will remain
          in full force and effect while you use the Site. We may suspend or
          terminate your rights to use the Site (including your Account) at any
          time for any reason at our sole discretion, including for any use of
          the Site in violation of these Terms. Upon termination of your rights
          under these Terms, your Account and right to access and use the Site
          will terminate immediately. You understand that any termination of
          your Account may involve deletion of your User Content associated with
          your Account from our live databases. Company will not have any
          liability whatsoever to you for any termination of your rights under
          these Terms, including for termination of your Account or deletion of
          your User Content. Even after your rights under these Terms are
          terminated, the following provisions of these Terms will remain in
          effect: Sections 2.2 through 2.6, Section 3 and Sections 4 through 10.
        </Paragraph>

        <Paragraph>Copyright Policy. </Paragraph>

        <Paragraph>
          Company respects the intellectual property of others and asks that
          users of our Site do the same. In connection with our Site, we have
          adopted and implemented a policy respecting copyright law that
          provides for the removal of any infringing materials and for the
          termination, in appropriate circumstances, of users of our online Site
          who are repeat infringers of intellectual property rights, including
          copyrights. If you believe that one of our users is, through the use
          of our Site, unlawfully infringing the copyright(s) in a work, and
          wish to have the allegedly infringing material removed, the following
          information in the form of a written notification (pursuant to 17
          U.S.C. § 512(c)) must be provided to our designated Copyright Agent:
        </Paragraph>

        <Paragraph>your physical or electronic signature;</Paragraph>

        <Paragraph>
          identification of the copyrighted work(s) that you claim to have been
          infringed;
        </Paragraph>

        <Paragraph>
          identification of the material on our services that you claim is
          infringing and that you request us to remove;
        </Paragraph>

        <Paragraph>
          sufficient information to permit us to locate such material;
        </Paragraph>

        <Paragraph>
          your address, telephone number, and e-mail address;
        </Paragraph>

        <Paragraph>
          a statement that you have a good faith belief that use of the
          objectionable material is not authorized by the copyright owner, its
          agent, or under the law; and
        </Paragraph>

        <Paragraph>
          a statement that the information in the notification is accurate, and
          under penalty of perjury, that you are either the owner of the
          copyright that has allegedly been infringed or that you are authorized
          to act on behalf of the copyright owner.
        </Paragraph>

        <Paragraph>
          Please note that, pursuant to 17 U.S.C. § 512(f), any
          misrepresentation of material fact (falsities) in a written
          notification automatically subjects the complaining party to liability
          for any damages, costs and attorney’s fees incurred by us in
          connection with the written notification and allegation of copyright
          infringement.
        </Paragraph>
        {/* 
      <Paragraph>
        *Please fill in the following fields once you have registered with the Copyright Office and
        delete the yellow highlighted text:*
      </Paragraph>

      <Paragraph>The designated Copyright Agent for Company is: _________ </Paragraph>

      <Paragraph>Designated Agent: _________</Paragraph>

      <Paragraph>Address of Agent: _________</Paragraph>

      <Paragraph>Telephone: _________</Paragraph>

      <Paragraph>Fax: _________</Paragraph>

      <Paragraph>Email: _________</Paragraph>

      <Paragraph> </Paragraph> */}

        <Paragraph>General</Paragraph>

        <Paragraph>
          Changes. These Terms are subject to occasional revision, and if we
          make any substantial changes, we may notify you by sending you an
          e-mail to the last e-mail address you provided to us (if any), and/or
          by prominently posting notice of the changes on our Site. You are
          responsible for providing us with your most current e-mail address. In
          the event that the last e-mail address that you have provided us is
          not valid, or for any reason is not capable of delivering to you the
          notice described above, our dispatch of the e-mail containing such
          notice will nonetheless constitute effective notice of the changes
          described in the notice. Continued use of our Site following notice of
          such changes shall indicate your acknowledgement of such changes and
          agreement to be bound by the terms and conditions of such changes.
        </Paragraph>

        <Paragraph>
          Dispute Resolution. Please read the following arbitration agreement in
          this Section (the “Arbitration Agreement”) carefully. It requires you
          to arbitrate disputes with Company, its parent companies,
          subsidiaries, affiliates, successors and assigns and all of their
          respective officers, directors, employees, agents, and representatives
          (collectively, the “Company Parties”) and limits the manner in which
          you can seek relief from the Company Parties.
        </Paragraph>

        <Paragraph>
          Applicability of Arbitration Agreement. You agree that any dispute
          between you and any of the Company Parties relating in any way to the
          Site, the services offered on the Site (the “Services”) or these Terms
          will be resolved by binding arbitration, rather than in court, except
          that (1) you and the Company Parties may assert individualized claims
          in small claims court if the claims qualify, remain in such court and
          advance solely on an individual, non-class basis; and (2) you or the
          Company Parties may seek equitable relief in court for infringement or
          other misuse of intellectual property rights (such as trademarks,
          trade dress, domain names, trade secrets, copyrights, and
          patents).This Arbitration Agreement shall survive the expiration or
          termination of these Terms and shall apply, without limitation, to all
          claims that arose or were asserted before you agreed to these Terms
          (in accordance with the preamble) or any prior version of these
          Terms.This Arbitration Agreement does not preclude you from bringing
          issues to the attention of federal, state or local agencies. Such
          agencies can, if the law allows, seek relief against the Company
          Parties on your behalf. For purposes of this Arbitration Agreement,
          “Dispute” will also include disputes that arose or involve facts
          occurring before the existence of this or any prior versions of the
          Agreement as well as claims that may arise after the termination of
          these Terms.
        </Paragraph>

        <Paragraph>
          Informal Dispute Resolution. There might be instances when a Dispute
          arises between you and Company. If that occurs, Company is committed
          to working with you to reach a reasonable resolution. You and Company
          agree that good faith informal efforts to resolve Disputes can result
          in a prompt, low‐cost and mutually beneficial outcome. You and Company
          therefore agree that before either party commences arbitration against
          the other (or initiates an action in small claims court if a party so
          elects), we will personally meet and confer telephonically or via
          videoconference, in a good faith effort to resolve informally any
          Dispute covered by this Arbitration Agreement (“Informal Dispute
          Resolution Conference”). If you are represented by counsel, your
          counsel may participate in the conference, but you will also
          participate in the conference.
        </Paragraph>

        <Paragraph>
          The party initiating a Dispute must give notice to the other party in
          writing of its intent to initiate an Informal Dispute Resolution
          Conference (“Notice”), which shall occur within 45 days after the
          other party receives such Notice, unless an extension is mutually
          agreed upon by the parties. Notice to Company that you intend to
          initiate an Informal Dispute Resolution Conference should be sent by
          email to:
          {contactEmail}, or by regular mail to 9 Tamizar, Irvine, California
          92620. The Notice must include: (1) your name, telephone number,
          mailing address, e‐mail address associated with your account (if you
          have one); (2) the name, telephone number, mailing address and e‐mail
          address of your counsel, if any; and (3) a description of your
          Dispute.{" "}
        </Paragraph>

        <Paragraph>
          The Informal Dispute Resolution Conference shall be individualized
          such that a separate conference must be held each time either party
          initiates a Dispute, even if the same law firm or group of law firms
          represents multiple users in similar cases, unless all parties agree;
          multiple individuals initiating a Dispute cannot participate in the
          same Informal Dispute Resolution Conference unless all parties agree.
          In the time between a party receiving the Notice and the Informal
          Dispute Resolution Conference, nothing in this Arbitration Agreement
          shall prohibit the parties from engaging in informal communications to
          resolve the initiating party’s Dispute. Engaging in the Informal
          Dispute Resolution Conference is a condition precedent and requirement
          that must be fulfilled before commencing arbitration. The statute of
          limitations and any filing fee deadlines shall be tolled while the
          parties engage in the Informal Dispute Resolution Conference process
          required by this section.
        </Paragraph>

        <Paragraph>
          {" "}
          Arbitration Rules and Forum.These Terms evidence a transaction
          involving interstate commerce; and notwithstanding any other provision
          herein with respect to the applicable substantive law, the Federal
          Arbitration Act, 9 U.S.C. § 1 et seq., will govern the interpretation
          and enforcement of this Arbitration Agreement and any arbitration
          proceedings. If the Informal Dispute Resolution Process described
          above does not resolve satisfactorily within 60 days after receipt of
          your Notice, you and Company agree that either party shall have the
          right to finally resolve the Dispute through binding arbitration. The
          Federal Arbitration Act governs the interpretation and enforcement of
          this Arbitration Agreement. The arbitration will be conducted by JAMS,
          an established alternative dispute resolution provider. Disputes
          involving claims and counterclaims with an amount in controversy under
          $250,000, not inclusive of attorneys’ fees and interest, shall be
          subject to JAMS’ most current version of the Streamlined Arbitration
          Rules and procedures available
          athttp://www.jamsadr.com/rules-streamlined-arbitration/; all other
          claims shall be subject to JAMS’s most current version of the
          Comprehensive Arbitration Rules and Procedures, available
          athttp://www.jamsadr.com/rules-comprehensive-arbitration/. JAMS’s
          rules are also available atwww.jamsadr.com or by calling JAMS at
          800-352-5267. A party who wishes to initiate arbitration must provide
          the other party with a request for arbitration (the “Request”). The
          Request must include: (1) the name, telephone number, mailing address,
          e‐mail address of the party seeking arbitration and the account
          username (if applicable) as well as the email address associated with
          any applicable account; (2) a statement of the legal claims being
          asserted and the factual bases of those claims; (3) a description of
          the remedy sought and an accurate, good‐faith calculation of the
          amount in controversy in United States Dollars; (4) a statement
          certifying completion of the Informal Dispute Resolution process as
          described above; and (5) evidence that the requesting party has paid
          any necessary filing fees in connection with such arbitration.
        </Paragraph>

        <Paragraph>
          If the party requesting arbitration is represented by counsel, the
          Request shall also include counsel’s name, telephone number, mailing
          address, and email address. Such counsel must also sign the Request.
          By signing the Request, counsel certifies to the best of counsel’s
          knowledge, information, and belief, formed after an inquiry reasonable
          under the circumstances, that: (1) the Request is not being presented
          for any improper purpose, such as to harass, cause unnecessary delay,
          or needlessly increase the cost of dispute resolution; (2) the claims,
          defenses and other legal contentions are warranted by existing law or
          by a nonfrivolous argument for extending, modifying, or reversing
          existing law or for establishing new law; and (3) the factual and
          damages contentions have evidentiary support or, if specifically so
          identified, will likely have evidentiary support after a reasonable
          opportunity for further investigation or discovery.
        </Paragraph>

        <Paragraph>
          Unless you and Company otherwise agree, or the Batch Arbitration
          process discussed in Subsection 10.2(h) is triggered, the arbitration
          will be conducted in the county where you reside. Subject to the JAMS
          Rules, the arbitrator may direct a limited and reasonable exchange of
          information between the parties, consistent with the expedited nature
          of the arbitration. If the JAMS is not available to arbitrate, the
          parties will select an alternative arbitral forum. Your responsibility
          to pay any JAMS fees and costs will be solely as set forth in the
          applicable JAMS Rules.
        </Paragraph>

        <Paragraph>
          You and Company agree that all materials and documents exchanged
          during the arbitration proceedings shall be kept confidential and
          shall not be shared with anyone except the parties’ attorneys,
          accountants, or business advisors, and then subject to the condition
          that they agree to keep all materials and documents exchanged during
          the arbitration proceedings confidential.
        </Paragraph>

        <Paragraph>
          Authority of Arbitrator. The arbitrator shall have exclusive authority
          to resolve all disputes subject to arbitration hereunder including,
          without limitation, any dispute related to the interpretation,
          applicability, enforceability or formation of this Arbitration
          Agreement or any portion of the Arbitration Agreement, except for the
          following: (1) all Disputes arising out of or relating to the
          subsection entitled “Waiver of Class or Other Non-Individualized
          Relief,” including any claim that all or part of the subsection
          entitled “Waiver of Class or Other Non-Individualized Relief” is
          unenforceable, illegal, void or voidable, or that such subsection
          entitled “Waiver of Class or Other Non-Individualized Relief” has been
          breached, shall be decided by a court of competent jurisdiction and
          not by an arbitrator; (2) except as expressly contemplated in the
          subsection entitled “Batch Arbitration,” all Disputes about the
          payment of arbitration fees shall be decided only by a court of
          competent jurisdiction and not by an arbitrator; (3) all Disputes
          about whether either party has satisfied any condition precedent to
          arbitration shall be decided only by a court of competent jurisdiction
          and not by an arbitrator; and (4) all Disputes about which version of
          the Arbitration Agreement applies shall be decided only by a court of
          competent jurisdiction and not by an arbitrator. The arbitration
          proceeding will not be consolidated with any other matters or joined
          with any other cases or parties, except as expressly provided in the
          subsection entitled “Batch Arbitration.” The arbitrator shall have the
          authority to grant motions dispositive of all or part of any claim or
          dispute. The arbitrator shall have the authority to award monetary
          damages and to grant any non-monetary remedy or relief available to an
          individual party under applicable law, the arbitral forum’s rules, and
          these Terms (including the Arbitration Agreement). The arbitrator
          shall issue a written award and statement of decision describing the
          essential findings and conclusions on which any award (or decision not
          to render an award) is based, including the calculation of any damages
          awarded. The arbitrator shall follow the applicable law. The award of
          the arbitrator is final and binding upon you and us. Judgment on the
          arbitration award may be entered in any court having jurisdiction.
        </Paragraph>

        <Paragraph>
          {" "}
          Waiver of Jury Trial.EXCEPT AS SPECIFIED in section 10.2(a) YOU AND
          THE COMPANY PARTIES HEREBY WAIVE ANY CONSTITUTIONAL AND STATUTORY
          RIGHTS TO SUE IN COURT AND HAVE A TRIAL IN FRONT OF A JUDGE OR A JURY.
          You and the Company Parties are instead electing that all covered
          claims and disputes shall be resolved exclusively by arbitration under
          this Arbitration Agreement, except as specified in Section 10.2(a)
          above. An arbitrator can award on an individual basis the same damages
          and relief as a court and must follow these Terms as a court would.
          However, there is no judge or jury in arbitration, and court review of
          an arbitration award is subject to very limited review.
        </Paragraph>

        <Paragraph>
          Waiver of Class or Other Non-Individualized Relief. YOU AND COMPANY
          AGREE THAT, EXCEPT AS SPECIFIED IN SUBSECTION 10.2(h) EACH OF US MAY
          BRING CLAIMS AGAINST THE OTHER ONLY ON AN INDIVIDUAL BASIS AND NOT ON
          A CLASS, REPRESENTATIVE, OR COLLECTIVE BASIS, AND THE PARTIES HEREBY
          WAIVE ALL RIGHTS TO HAVE ANY DISPUTE BE BROUGHT, HEARD, ADMINISTERED,
          RESOLVED, OR ARBITRATED ON A CLASS, COLLECTIVE, REPRESENTATIVE, OR
          MASS ACTION BASIS. ONLY INDIVIDUAL RELIEF IS AVAILABLE, AND DISPUTES
          OF MORE THAN ONE CUSTOMER OR USER CANNOT BE ARBITRATED OR CONSOLIDATED
          WITH THOSE OF ANY OTHER CUSTOMER OR USER. Subject to this Arbitration
          Agreement, the arbitrator may award declaratory or injunctive relief
          only in favor of the individual party seeking relief and only to the
          extent necessary to provide relief warranted by the party’s individual
          claim. Nothing in this paragraph is intended to, nor shall it, affect
          the terms and conditions under the Subsection 10.2(h) entitled “Batch
          Arbitration.” Notwithstanding anything to the contrary in this
          Arbitration Agreement, if a court decides by means of a final
          decision, not subject to any further appeal or recourse, that the
          limitations of this subsection, “Waiver of Class or Other
          Non-Individualized Relief,” are invalid or unenforceable as to a
          particular claim or request for relief (such as a request for public
          injunctive relief), you and Company agree that that particular claim
          or request for relief (and only that particular claim or request for
          relief) shall be severed from the arbitration and may be litigated in
          the state or federal courts located in the State of California. All
          other Disputes shall be arbitrated or litigated in small claims court.
          This subsection does not prevent you or Company from participating in
          a class-wide settlement of claims.
        </Paragraph>

        <Paragraph>
          Attorneys’ Fees and Costs. The parties shall bear their own attorneys’
          fees and costs in arbitration unless the arbitrator finds that either
          the substance of the Dispute or the relief sought in the Request was
          frivolous or was brought for an improper purpose (as measured by the
          standards set forth in Federal Rule of Civil Procedure 11(b)). If you
          or Company need to invoke the authority of a court of competent
          jurisdiction to compel arbitration, then the party that obtains an
          order compelling arbitration in such action shall have the right to
          collect from the other party its reasonable costs, necessary
          disbursements, and reasonable attorneys’ fees incurred in securing an
          order compelling arbitration. The prevailing party in any court action
          relating to whether either party has satisfied any condition precedent
          to arbitration, including the Informal Dispute Resolution Process, is
          entitled to recover their reasonable costs, necessary disbursements,
          and reasonable attorneys’ fees and costs.
        </Paragraph>

        <Paragraph>
          Batch Arbitration. To increase the efficiency of administration and
          resolution of arbitrations, you and Company agree that in the event
          that there are 100 or more individual Requests of a substantially
          similar nature filed against Company by or with the assistance of the
          same law firm, group of law firms, or organizations, within a 30 day
          period (or as soon as possible thereafter), the JAMS shall (1)
          administer the arbitration demands in batches of 100 Requests per
          batch (plus, to the extent there are less than 100 Requests left over
          after the batching described above, a final batch consisting of the
          remaining Requests); (2) appoint one arbitrator for each batch; and
          (3) provide for the resolution of each batch as a single consolidated
          arbitration with one set of filing and administrative fees due per
          side per batch, one procedural calendar, one hearing (if any) in a
          place to be determined by the arbitrator, and one final award (“Batch
          Arbitration”).
        </Paragraph>

        <Paragraph>
          All parties agree that Requests are of a “substantially similar
          nature” if they arise out of or relate to the same event or factual
          scenario and raise the same or similar legal issues and seek the same
          or similar relief. To the extent the parties disagree on the
          application of the Batch Arbitration process, the disagreeing party
          shall advise the JAMS, and the JAMS shall appoint a sole standing
          arbitrator to determine the applicability of the Batch Arbitration
          process (“Administrative Arbitrator”). In an effort to expedite
          resolution of any such dispute by the Administrative Arbitrator, the
          parties agree the Administrative Arbitrator may set forth such
          procedures as are necessary to resolve any disputes promptly. The
          Administrative Arbitrator’s fees shall be paid by Company.
        </Paragraph>

        <Paragraph>
          You and Company agree to cooperate in good faith with the JAMS to
          implement the Batch Arbitration process including the payment of
          single filing and administrative fees for batches of Requests, as well
          as any steps to minimize the time and costs of arbitration, which may
          include: (1) the appointment of a discovery special master to assist
          the arbitrator in the resolution of discovery disputes; and (2) the
          adoption of an expedited calendar of the arbitration proceedings.
        </Paragraph>

        <Paragraph>
          This Batch Arbitration provision shall in no way be interpreted as
          authorizing a class, collective and/or mass arbitration or action of
          any kind, or arbitration involving joint or consolidated claims under
          any circumstances, except as expressly set forth in this provision.
        </Paragraph>

        <Paragraph>
          30-Day Right to Opt Out. You have the right to opt out of the
          provisions of this Arbitration Agreement by sending a timely written
          notice of your decision to opt out to the following address: 9
          Tamizar, Irvine, California 92620, or email to {contactEmail}, within
          30 days after first becoming subject to this Arbitration Agreement.
          Your notice must include your name and address and a clear statement
          that you want to opt out of this Arbitration Agreement. If you opt out
          of this Arbitration Agreement, all other parts of these Terms will
          continue to apply to you. Opting out of this Arbitration Agreement has
          no effect on any other arbitration agreements that you may currently
          have with us, or may enter into in the future with us.
        </Paragraph>

        <Paragraph>
          Invalidity, Expiration. Except as provided in the subsection entitled
          “Waiver of Class or Other Non-Individualized Relief”, if any part or
          parts of this Arbitration Agreement are found under the law to be
          invalid or unenforceable, then such specific part or parts shall be of
          no force and effect and shall be severed and the remainder of the
          Arbitration Agreement shall continue in full force and effect. You
          further agree that any Dispute that you have with Company as detailed
          in this Arbitration Agreement must be initiated via arbitration within
          the applicable statute of limitation for that claim or controversy, or
          it will be forever time barred. Likewise, you agree that all
          applicable statutes of limitation will apply to such arbitration in
          the same manner as those statutes of limitation would apply in the
          applicable court of competent jurisdiction.
        </Paragraph>

        <Paragraph>
          Modification.Notwithstanding any provision in these Terms to the
          contrary, we agree that if Company makes any future material change to
          this Arbitration Agreement, you may reject that change within 30 days
          of such change becoming effective by writing Company at the following
          address: 9 Tamizar, Irvine, California 92620, or email to
          {contactEmail}. Unless you reject the change within 30 days of such
          change becoming effective by writing to Company in accordance with the
          foregoing, your continued use of the Site and/or Services, including
          the acceptance of products and services offered on the Site following
          the posting of changes to this Arbitration Agreement constitutes your
          acceptance of any such changes. Changes to this Arbitration Agreement
          do not provide you with a new opportunity to opt out of the
          Arbitration Agreement if you have previously agreed to a version of
          these Terms and did not validly opt out of arbitration. If you reject
          any change or update to this Arbitration Agreement, and you were bound
          by an existing agreement to arbitrate Disputes arising out of or
          relating in any way to your access to or use of the Services or of the
          Site, any communications you receive, any products sold or distributed
          through the Site, the Services, or these Terms, the provisions of this
          Arbitration Agreement as of the date you first accepted these Terms
          (or accepted any subsequent changes to these Terms) remain in full
          force and effect. Company will continue to honor any valid opt outs of
          the Arbitration Agreement that you made to a prior version of these
          Terms.
        </Paragraph>

        <Paragraph>
          Export. The Site may be subject to U.S. export control laws and may be
          subject to export or import regulations in other countries. You agree
          not to export, reexport, or transfer, directly or indirectly, any U.S.
          technical data acquired from Company, or any products utilizing such
          data, in violation of the United States export laws or
          regulations.{" "}
        </Paragraph>

        <Paragraph>
          Disclosures. Company is located at the address in Section 10.8. If you
          are a California resident, you may report complaints to the Complaint
          Assistance Unit of the Division of Consumer Product of the California
          Department of Consumer Affairs by contacting them in writing at 400 R
          Street, Sacramento, CA 95814, or by telephone at (800) 952-5210.
        </Paragraph>

        <Paragraph>
          Electronic Communications. The communications between you and Company
          use electronic means, whether you use the Site or send us emails, or
          whether Company posts notices on the Site or communicates with you via
          email. For contractual purposes, you (a) consent to receive
          communications from Company in an electronic form; and (b) agree that
          all terms and conditions, agreements, notices, disclosures, and other
          communications that Company provides to you electronically satisfy any
          legal requirement that such communications would satisfy if it were be
          in a hardcopy writing. The foregoing does not affect your non-waivable
          rights.
        </Paragraph>

        <Paragraph>
          Entire Terms. These Terms constitute the entire agreement between you
          and us regarding the use of the Site. Our failure to exercise or
          enforce any right or provision of these Terms shall not operate as a
          waiver of such right or provision. The section titles in these Terms
          are for convenience only and have no legal or contractual effect. The
          word “including” means “including without limitation”. If any
          provision of these Terms is, for any reason, held to be invalid or
          unenforceable, the other provisions of these Terms will be unimpaired
          and the invalid or unenforceable provision will be deemed modified so
          that it is valid and enforceable to the maximum extent permitted by
          law. Your relationship to Company is that of an independent
          contractor, and neither party is an agent or partner of the other.
          These Terms, and your rights and obligations herein, may not be
          assigned, subcontracted, delegated, or otherwise transferred by you
          without Company’s prior written consent, and any attempted assignment,
          subcontract, delegation, or transfer in violation of the foregoing
          will be null and void. Company may freely assign these Terms. The
          terms and conditions set forth in these Terms shall be binding upon
          assignees.{" "}
        </Paragraph>

        <Paragraph>
          Copyright/Trademark Information. Copyright © 2023 {company}. All
          rights reserved. All trademarks, logos and service marks (“Marks”)
          displayed on the Site are our property or the property of other third
          parties. You are not permitted to use these Marks without our prior
          written consent or the consent of such third party which may own the
          Marks.
        </Paragraph>

        <Paragraph>* * *</Paragraph>

        <Paragraph>
          Information about Digital Millennium Copyright Act (“DMCA”) Safe
          Harbor:
        </Paragraph>

        <Paragraph>
          The Copyright Policy section (Section 9 above) has been included
          because you indicated that {appUrl} includes user content. We
          recommend you take advantage of the DMCA safe harbor.
        </Paragraph>

        <Paragraph>
          The DMCA provides certain “safe harbor” provisions that insulate
          online service providers (OSP) from liability for copyright
          infringement for infringing activities of its end users. In addition
          to meeting the requirements for each safe harbor exemption, an OSP
          must comply with the following to qualify for the safe harbor
          protection under the DMCA:
        </Paragraph>

        <Paragraph>
          (a) Give notice to its users of its policies regarding copyright
          infringement and the consequences of repeated infringing activity.
        </Paragraph>

        <Paragraph>
          (b) Follow proper notice and takedown procedures. Once a copyright
          owner provides proper notice of allegedly infringing material to the
          OSP, or the OSP discovers such material itself, the OSP must remove,
          or disable access to, the material; provide notice thereafter to the
          individual responsible for such material; provide such individual with
          an opportunity to provide proper “counter-notice;” and comply with
          applicable procedures thereafter.
        </Paragraph>

        <Paragraph>
          (c) Designate an agent to receive notices of infringement from
          copyright owners (and provide the Copyright Office with contact
          information for such agent and make such information available on its
          website).
        </Paragraph>

        <Paragraph>
          See: http://www.copyright.gov/onlinesp/ for the applicable forms and
          more information.
        </Paragraph>
      </div>
    </div>
  );
};

export const EulaScreen = ({
  appUrl,
  lastUpdated,
  company,
  contactEmail,
}: {
  appUrl: string;
  lastUpdated: string;
  company: string;
  contactEmail: string;
}) => {
  return (
    <div className="h-screen overflow-auto">
      <div className="px-4">
        <H1>End-User License Agreement</H1>

        <Paragraph>Our EULA was last updated on {lastUpdated}</Paragraph>

        <Paragraph>
          Please read this End-User License Agreement carefully before clicking
          the "I Agree" button, downloading or using cmux.
        </Paragraph>

        <Paragraph>Interpretation and Definitions</Paragraph>

        <Paragraph>Interpretation</Paragraph>

        <Paragraph>
          The words of which the initial letter is capitalized have meanings
          defined under the following conditions. The following definitions
          shall have the same meaning regardless of whether they appear in
          singular or in plural.
        </Paragraph>

        <Paragraph>Definitions</Paragraph>

        <Paragraph>
          For the purposes of this End-User License Agreement:
        </Paragraph>

        <Paragraph>
          "Agreement" means this End-User License Agreement that forms the
          entire agreement between You and the Company regarding the use of the
          Application.
        </Paragraph>

        <Paragraph>
          "Application" means the software program and web service provided by
          the Company, known as cmux, which enables users to run AI-powered
          coding agents in parallel across multiple tasks with isolated
          development environments.
        </Paragraph>

        <Paragraph>
          "Company" (referred to as either "the Company", "We", "Us" or "Our" in
          this Agreement) refers to {company}.
        </Paragraph>

        <Paragraph>
          "Content" refers to content such as text, code, images, or other
          information that can be posted, uploaded, linked to or otherwise made
          available by You, regardless of the form of that content.
        </Paragraph>

        <Paragraph>"Country" refers to: United States</Paragraph>

        <Paragraph>
          "Device" means any device that can access the Application such as a
          computer, a cellphone or a digital tablet.
        </Paragraph>

        <Paragraph>
          "Third-Party Services" means any services or content (including data,
          information, applications and other products services) provided by a
          third-party that may be displayed, included or made available by the
          Application, including AI service providers such as Anthropic, OpenAI,
          Google, and sandbox providers.
        </Paragraph>

        <Paragraph>
          "You" means the individual accessing or using the Application or the
          company, or other legal entity on behalf of which such individual is
          accessing or using the Application, as applicable.
        </Paragraph>

        <Paragraph>Acknowledgment</Paragraph>

        <Paragraph>
          By clicking the "I Agree" button, downloading or using the
          Application, You are agreeing to be bound by the terms and conditions
          of this Agreement. If You do not agree to the terms of this Agreement,
          do not click on the "I Agree" button, do not download or do not use
          the Application.
        </Paragraph>

        <Paragraph>
          This Agreement is a legal document between You and the Company and it
          governs your use of the Application made available to You by the
          Company.
        </Paragraph>

        <Paragraph>
          The Application is licensed, not sold, to You by the Company for use
          strictly in accordance with the terms of this Agreement.
        </Paragraph>

        <Paragraph>License</Paragraph>

        <Paragraph>Scope of License</Paragraph>

        <Paragraph>
          The Company grants You a revocable, non-exclusive, non-transferable,
          limited license to download, install and use the Application strictly
          in accordance with the terms of this Agreement.
        </Paragraph>

        <Paragraph>
          The license that is granted to You by the Company is for your personal
          or internal business purposes, including commercial use in connection
          with your software development activities, strictly in accordance with
          the terms of this Agreement.
        </Paragraph>

        <Paragraph>License Restrictions</Paragraph>

        <Paragraph>
          You agree not to, and You will not permit others to:
        </Paragraph>

        <Paragraph>
          - License, sell, rent, lease, assign, distribute, transmit, host,
          outsource, disclose or otherwise commercially exploit the Application
          or make the Application available to any third party.
        </Paragraph>

        <Paragraph>
          - Remove, alter or obscure any proprietary notice (including any
          notice of copyright or trademark) of the Company or its affiliates,
          partners, suppliers or the licensors of the Application.
        </Paragraph>

        <Paragraph>
          - Use the Application to generate code intended for unlawful purposes.
        </Paragraph>

        <Paragraph>
          - Attempt to circumvent any security measures or usage limits of the
          Application or its integrated AI services.
        </Paragraph>

        <Paragraph>Intellectual Property</Paragraph>

        <Paragraph>
          The Application, including without limitation all copyrights, patents,
          trademarks, trade secrets and other intellectual property rights are,
          and shall remain, the sole and exclusive property of the Company.
        </Paragraph>

        <Paragraph>
          You retain ownership of any code or content you create using the
          Application, subject to any applicable third-party AI provider terms.
        </Paragraph>

        <Paragraph>
          The Company shall not be obligated to indemnify or defend You with
          respect to any third party claim arising out of or relating to the
          Application.
        </Paragraph>

        <Paragraph>Modifications to the Application</Paragraph>

        <Paragraph>
          The Company reserves the right to modify, suspend or discontinue,
          temporarily or permanently, the Application or any service to which it
          connects, with or without notice and without liability to You.
        </Paragraph>

        <Paragraph>Updates to the Application</Paragraph>

        <Paragraph>
          The Company may from time to time provide enhancements or improvements
          to the features/functionality of the Application, which may include
          patches, bug fixes, updates, upgrades and other modifications.
        </Paragraph>

        <Paragraph>
          Updates may modify or delete certain features and/or functionalities
          of the Application. You agree that the Company has no obligation to
          (i) provide any Updates, or (ii) continue to provide or enable any
          particular features and/or functionalities of the Application to You.
        </Paragraph>

        <Paragraph>
          You further agree that all updates or any other modifications will be
          (i) deemed to constitute an integral part of the Application, and (ii)
          subject to the terms and conditions of this Agreement.
        </Paragraph>

        <Paragraph>Maintenance and Support</Paragraph>

        <Paragraph>
          The Company does not provide any maintenance or support for the
          download and use of the Application unless you are subscribed to a
          paid tier that includes support.
        </Paragraph>

        <Paragraph>Third-Party Services</Paragraph>

        <Paragraph>
          The Application may display, include or make available third-party
          content (including data, information, applications and other products
          services) or provide links to third-party websites or services,
          including AI coding agents from providers such as Anthropic, OpenAI,
          and Google.
        </Paragraph>

        <Paragraph>
          You acknowledge and agree that the Company shall not be responsible
          for any Third-party Services, including their accuracy, completeness,
          timeliness, validity, copyright compliance, legality, decency, quality
          or any other aspect thereof. The Company does not assume and shall not
          have any liability or responsibility to You or any other person or
          entity for any Third-party Services.
        </Paragraph>

        <Paragraph>
          You must comply with applicable Third parties' Terms of agreement when
          using the Application. Third-party Services and links thereto are
          provided solely as a convenience to You and You access and use them
          entirely at your own risk and subject to such third parties' Terms and
          conditions.
        </Paragraph>

        <Paragraph>Term and Termination</Paragraph>

        <Paragraph>
          This Agreement shall remain in effect until terminated by You or the
          Company. The Company may, in its sole discretion, at any time and for
          any or no reason, suspend or terminate this Agreement with or without
          prior notice.
        </Paragraph>

        <Paragraph>
          This Agreement will terminate immediately, without prior notice from
          the Company, in the event that you fail to comply with any provision
          of this Agreement. You may also terminate this Agreement by deleting
          the Application and all copies thereof from your Device.
        </Paragraph>

        <Paragraph>
          Upon termination of this Agreement, You shall cease all use of the
          Application and delete all copies of the Application from your Device.
        </Paragraph>

        <Paragraph>
          Termination of this Agreement will not limit any of the Company's
          rights or remedies at law or in equity in case of breach by You
          (during the term of this Agreement) of any of your obligations under
          the present Agreement.
        </Paragraph>

        <Paragraph>Indemnification</Paragraph>

        <Paragraph>
          You agree to indemnify and hold the Company and its parents,
          subsidiaries, affiliates, officers, employees, agents, partners and
          licensors (if any) harmless from any claim or demand, including
          reasonable attorneys' fees, due to or arising out of your: (a) use of
          the Application; (b) violation of this Agreement or any law or
          regulation; or (c) violation of any right of a third party.
        </Paragraph>

        <Paragraph>No Warranties</Paragraph>

        <Paragraph>
          The Application is provided to You "AS IS" and "AS AVAILABLE" and with
          all faults and defects without warranty of any kind. To the maximum
          extent permitted under applicable law, the Company, on its own behalf
          and on behalf of its affiliates and its and their respective licensors
          and service providers, expressly disclaims all warranties, whether
          express, implied, statutory or otherwise, with respect to the
          Application, including all implied warranties of merchantability,
          fitness for a particular purpose, title and non-infringement.
        </Paragraph>

        <Paragraph>
          Without limiting the foregoing, the Company provides no warranty or
          undertaking, and makes no representation of any kind that the
          Application will meet your requirements, achieve any intended results,
          be compatible or work with any other software, applications, systems
          or services, operate without interruption, meet any performance or
          reliability standards or be error free or that any errors or defects
          can or will be corrected.
        </Paragraph>

        <Paragraph>
          AI-GENERATED CODE AND SUGGESTIONS MAY CONTAIN ERRORS, SECURITY
          VULNERABILITIES, OR INACCURACIES. YOU ARE SOLELY RESPONSIBLE FOR
          REVIEWING, TESTING, AND VALIDATING ANY AI-GENERATED CODE BEFORE USE.
        </Paragraph>

        <Paragraph>
          Some jurisdictions do not allow the exclusion of certain types of
          warranties or limitations on applicable statutory rights of a
          consumer, so some or all of the above exclusions and limitations may
          not apply to You. But in such a case the exclusions and limitations
          set forth in this section shall be applied to the greatest extent
          enforceable under applicable law.
        </Paragraph>

        <Paragraph>Limitation of Liability</Paragraph>

        <Paragraph>
          Notwithstanding any damages that You might incur, the entire liability
          of the Company and any of its suppliers under any provision of this
          Agreement and your exclusive remedy for all of the foregoing shall be
          limited to the amount actually paid by You for the Application or
          through the Application or 100 USD if You haven't purchased anything
          through the Application.
        </Paragraph>

        <Paragraph>
          To the maximum extent permitted by applicable law, in no event shall
          the Company or its suppliers be liable for any special, incidental,
          indirect, or consequential damages whatsoever (including, but not
          limited to, damages for loss of profits, loss of data or other
          information, for business interruption, for personal injury, loss of
          privacy arising out of or in any way related to the use of or
          inability to use the Application, third-party software and/or
          third-party hardware used with the Application, or otherwise in
          connection with any provision of this Agreement), even if the Company
          or any supplier has been advised of the possibility of such damages
          and even if the remedy fails of its essential purpose.
        </Paragraph>

        <Paragraph>
          Some states/jurisdictions do not allow the exclusion or limitation of
          incidental or consequential damages, so the above limitation or
          exclusion may not apply to You.
        </Paragraph>

        <Paragraph>Severability and Waiver</Paragraph>

        <Paragraph>Severability</Paragraph>

        <Paragraph>
          If any provision of this Agreement is held to be unenforceable or
          invalid, such provision will be changed and interpreted to accomplish
          the objectives of such provision to the greatest extent possible under
          applicable law and the remaining provisions will continue in full
          force and effect.
        </Paragraph>

        <Paragraph>Waiver</Paragraph>

        <Paragraph>
          Except as provided herein, the failure to exercise a right or to
          require performance of an obligation under this Agreement shall not
          effect a party's ability to exercise such right or require such
          performance at any time thereafter nor shall the waiver of a breach
          constitute a waiver of any subsequent breach.
        </Paragraph>

        <Paragraph>Product Claims</Paragraph>

        <Paragraph>
          The Company does not make any warranties concerning the Application.
          To the extent You have any claim arising from or relating to your use
          of the Application, the Company is responsible for addressing any such
          claims, which may include, but not limited to: (i) any product
          liability claims; (ii) any claim that the Application fails to conform
          to any applicable legal or regulatory requirement; and (iii) any claim
          arising under consumer protection, or similar legislation.
        </Paragraph>

        <Paragraph>United States Legal Compliance</Paragraph>

        <Paragraph>
          You represent and warrant that (i) You are not located in a country
          that is subject to the United States government embargo, or that has
          been designated by the United States government as a "terrorist
          supporting" country, and (ii) You are not listed on any United States
          government list of prohibited or restricted parties.
        </Paragraph>

        <Paragraph>Changes to this Agreement</Paragraph>

        <Paragraph>
          The Company reserves the right, at its sole discretion, to modify or
          replace this Agreement at any time. If a revision is material we will
          provide at least 30 days' notice prior to any new terms taking effect.
          What constitutes a material change will be determined at the sole
          discretion of the Company.
        </Paragraph>

        <Paragraph>
          By continuing to access or use the Application after any revisions
          become effective, You agree to be bound by the revised terms. If You
          do not agree to the new terms, You are no longer authorized to use the
          Application.
        </Paragraph>

        <Paragraph>Governing Law</Paragraph>

        <Paragraph>
          The laws of the Country, excluding its conflicts of law rules, shall
          govern this Agreement and your use of the Application. Your use of the
          Application may also be subject to other local, state, national, or
          international laws.
        </Paragraph>

        <Paragraph>Entire Agreement</Paragraph>

        <Paragraph>
          The Agreement constitutes the entire agreement between You and the
          Company regarding your use of the Application and supersedes all prior
          and contemporaneous written or oral agreements between You and the
          Company.
        </Paragraph>

        <Paragraph>
          You may be subject to additional terms and conditions that apply when
          You use or purchase other Company's services, which the Company will
          provide to You at the time of such use or purchase.
        </Paragraph>

        <Paragraph>Contact Us</Paragraph>

        <Paragraph>
          If you have any questions about this Agreement, You can contact Us:
        </Paragraph>

        <Paragraph>
          - By visiting this page on our website: {appUrl}/contact
        </Paragraph>

        <Paragraph>- By sending us an email: {contactEmail}</Paragraph>
      </div>
    </div>
  );
};
